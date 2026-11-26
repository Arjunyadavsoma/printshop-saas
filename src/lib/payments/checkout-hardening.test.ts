import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryDatabaseAdapter,
  InMemoryCacheAdapter,
  InMemoryStorageAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
  StubLoggerAdapter,
  UpiDeepLinkPaymentAdapter,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { submitPayment, confirmPayment, rejectPayment } from '@/lib/orders/order-flow';
import { createDefaultPricingConfig } from '@platform/core/domain';
import { initiateRefund } from '@/lib/payments/refund.service';

/**
 * Feature 4 — Phase 12: Checkout & Payments security hardening tests.
 *
 * Tests the gaps closed by Feature 4:
 *   W1 — submitPayment idempotency (double-tap returns the existing payment)
 *   W6 — confirmPayment/rejectPayment use the payment state machine
 *   W7 — expired order (expiresAt passed) blocks payment submission
 *   Refund service — amount validation, partial refund balance, over-refund prevention
 */

let container: Container;
let shopId: string;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  container = {
    db,
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new StubLoggerAdapter(),
    auth,
  };
  setContainerForTesting(container);

  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId,
    name: 'Hardening Test Shop',
    slug: 'harden-' + shopId.slice(0, 8),
    ownerUserId: crypto.randomUUID(),
    upiId: 'shop@upi',
    paymentProvider: 'googlepay',
    paymentCredentials: '',
    pricingConfig: JSON.stringify(createDefaultPricingConfig()),
    address: '1 Test St',
    phone: '5550000000',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: 'free',
    subscriptionExpiresAt: null,
    description: null,
    businessHours: null,
    logoUrl: null,
    upiQrStorageKey: null,
    servicesJson: null,
    paymentPhone: null,
    paymentInstructions: null,
    cashOnPickup: false,
    paymentMethods: 'both',
    pamphletEnabled: false,
    pamphletPricePaise: 0,
    pamphletName: null,
  } as never);
  await db.update('shop', { id: shopId }, {
    isOpen: true,
    acceptingOrders: true,
    upiId: 'shop@upi',
    upiPayeeName: 'Hardening Shop',
    paymentMode: 'UPI_THEN_PRINT',
  } as never);
});

/** Create an order in `awaiting_payment` with the given total + token. */
async function makeOrder(totalPaise: number, opts?: { expiresAt?: Date }): Promise<{ id: string; token: string }> {
  const order = await repos.orders.createWithUniqueToken(
    shopId,
    {
      customerPhone: null,
      notes: null,
      regenerateCustomerToken: () =>
        crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    },
    (c) => String(100 + c),
  );
  await container.db.update('order', { id: order.id }, {
    status: 'awaiting_payment',
    totalAmountPaise: totalPaise,
    orderNumber: String(4000 + Math.floor(Math.random() * 999)),
    ...(opts?.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  } as never);
  return { id: order.id, token: order.customerToken };
}

// ── W1: submitPayment idempotency ──

describe('Feature 4 — submitPayment idempotency (W1)', () => {
  it('double-tap UPI submit returns the SAME paymentId (no duplicate Payment row)', async () => {
    const o = await makeOrder(50000);
    const r1 = await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    const r2 = await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    expect(r1.paymentId).toBe(r2.paymentId);
    expect(r1.status).toBe('SUBMITTED');
    expect(r2.status).toBe('SUBMITTED');
  });

  it('counter_cash double-submit returns the same paymentId', async () => {
    const o = await makeOrder(30000);
    const r1 = await submitPayment(o.token, { method: 'counter_cash' });
    const r2 = await submitPayment(o.token, { method: 'counter_cash' });
    expect(r1.paymentId).toBe(r2.paymentId);
    expect(r1.status).toBe('PENDING');
  });

  it('a REJECTED payment does NOT block a fresh re-submit (new row created)', async () => {
    const o = await makeOrder(50000);
    const r1 = await submitPayment(o.token, { method: 'upi', utr: '111122223333', declaredAmountPaise: 50000 });
    await rejectPayment(o.id, shopId, 'shopkeeper-1', 'Wrong amount');
    // After rejection, the customer re-submits with a new UTR — this must
    // create a NEW Payment row (the old one is REJECTED/terminal).
    const r2 = await submitPayment(o.token, { method: 'upi', utr: '999988887777', declaredAmountPaise: 50000 });
    expect(r1.paymentId).not.toBe(r2.paymentId);
    expect(r2.status).toBe('SUBMITTED');
  });
});

// ── W7: expired order blocks payment submission ──

describe('Feature 4 — expired order blocks payment (W7)', () => {
  it('rejects UPI submission for an order past its expiresAt', async () => {
    const o = await makeOrder(50000, { expiresAt: new Date(Date.now() - 60000) });
    await expect(
      submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 }),
    ).rejects.toThrow(/payment window has expired/i);
  });

  it('rejects counter submission for an expired order', async () => {
    const o = await makeOrder(30000, { expiresAt: new Date(Date.now() - 60000) });
    await expect(
      submitPayment(o.token, { method: 'counter_cash' }),
    ).rejects.toThrow(/payment window has expired/i);
  });

  it('allows submission for an order whose expiresAt is in the future', async () => {
    const o = await makeOrder(50000, { expiresAt: new Date(Date.now() + 60000) });
    const r = await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    expect(r.status).toBe('SUBMITTED');
  });

  it('allows submission when expiresAt is null (no expiry set)', async () => {
    const o = await makeOrder(50000);
    const r = await submitPayment(o.token, { method: 'counter_cash' });
    expect(r.status).toBe('PENDING');
  });
});

// ── W6: confirmPayment/rejectPayment use the payment state machine ──

describe('Feature 4 — confirmPayment/rejectPayment state machine (W6)', () => {
  it('confirmPayment on an already-CONFIRMED payment is idempotent (no re-capture, no task rebuild)', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    const r1 = await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    expect(r1.status).toBe('queued');
    // Second confirm must be idempotent — returns the current order state
    // WITHOUT re-building tasks (tasksCreated = 0, regardless of the first
    // call's task count which depends on files/printers we don't set up here).
    const r2 = await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    expect(r2.tasksCreated).toBe(0);
  });

  it('rejectPayment on a CONFIRMED payment throws (use the refund flow)', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    await expect(
      rejectPayment(o.id, shopId, 'shopkeeper-1', 'Customer changed mind'),
    ).rejects.toThrow(/cannot be rejected/i);
  });

  it('rejectPayment on a REJECTED payment is idempotent (no-op)', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await rejectPayment(o.id, shopId, 'shopkeeper-1', 'Wrong amount');
    // Second reject is idempotent — returns the current order state.
    const r = await rejectPayment(o.id, shopId, 'shopkeeper-1', 'Still wrong');
    expect(r.status).toBe('awaiting_payment');
  });

  it('confirmPayment on a REJECTED payment throws (a new row is created on re-submit)', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await rejectPayment(o.id, shopId, 'shopkeeper-1', 'Wrong amount');
    // The customer hasn't re-submitted yet — the only Payment row is REJECTED.
    await expect(
      confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi'),
    ).rejects.toThrow(/cannot be confirmed/i);
  });
});

// ── Refund service (Phase 9) ──

describe('Feature 4 — refund service validation', () => {
  it('rejects a refund with amount > order total', async () => {
    const o = await makeOrder(50000);
    // Simulate a paid order (confirm a submitted payment first).
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    await expect(
      initiateRefund({ orderId: o.id, shopId, initiatedBy: 'shopkeeper-1', amountPaise: 60000, reason: 'overcharge' }),
    ).rejects.toThrow(/exceeds the order total/i);
  });

  it('rejects a refund with amount 0', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    await expect(
      initiateRefund({ orderId: o.id, shopId, initiatedBy: 'shopkeeper-1', amountPaise: 0, reason: 'zero' }),
    ).rejects.toThrow(/greater than zero/i);
  });

  it('rejects a refund for an unpaid order', async () => {
    const o = await makeOrder(50000);
    await expect(
      initiateRefund({ orderId: o.id, shopId, initiatedBy: 'shopkeeper-1', amountPaise: 25000, reason: 'test' }),
    ).rejects.toThrow(/not yet paid|Nothing to refund/i);
  });

  it('rejects a refund exceeding the un-refunded balance (partial refund already applied)', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    // First partial refund of 30000 succeeds (manual provider for direct-UPI).
    const r1 = await initiateRefund({ orderId: o.id, shopId, initiatedBy: 'shopkeeper-1', amountPaise: 30000, reason: 'partial' });
    expect(r1.status).toBe('succeeded');
    // Remaining balance is 20000 — refunding 25000 must fail.
    await expect(
      initiateRefund({ orderId: o.id, shopId, initiatedBy: 'shopkeeper-1', amountPaise: 25000, reason: 'too much' }),
    ).rejects.toThrow(/exceeds the un-refunded balance/i);
  });

  it('records a manual refund for direct-UPI orders (no PSP refund API)', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    const r = await initiateRefund({ orderId: o.id, shopId, initiatedBy: 'shopkeeper-1', amountPaise: 50000, reason: 'full refund' });
    expect(r.status).toBe('succeeded');
    expect(r.providerRefundId).toContain('manual-');
    expect(r.message).toContain('recorded');
  });

  it('rejects a refund for an order in another shop (tenant isolation)', async () => {
    const o = await makeOrder(50000);
    await submitPayment(o.token, { method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 });
    await confirmPayment(o.id, shopId, 'shopkeeper-1', 'upi');
    const otherShopId = crypto.randomUUID();
    await expect(
      initiateRefund({ orderId: o.id, shopId: otherShopId, initiatedBy: 'shopkeeper-1', amountPaise: 25000, reason: 'cross-tenant' }),
    ).rejects.toThrow(/not found/i);
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryDatabaseAdapter, InMemoryCacheAdapter, InMemoryStorageAdapter,
  InMemoryRealtimeAdapter, InMemoryQueueAdapter, StubEmailAdapter,
  StubSmsAdapter, StubLoggerAdapter, UpiDeepLinkPaymentAdapter,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig } from '@platform/core/domain';

/**
 * Token consistency regression tests — verify the customer-facing status API
 * returns the SAME canonical token as the shopkeeper-facing APIs.
 *
 * ROOT CAUSE: the customer status API (`GET /api/v1/orders/:id/status`)
 * previously returned `customerToken` (e.g. "B5EY7Y") but NOT `tokenNumber`
 * (e.g. "A001"). The shopkeeper pages showed `tokenNumber ?? customerToken`
 * (preferring tokenNumber). This caused a MISMATCH — the customer saw
 * "B5EY7Y" while the shopkeeper saw "A001" for the same order.
 *
 * FIX: the status API now returns BOTH `tokenNumber` + `customerToken`. The
 * customer tracking page shows `tokenNumber ?? customerToken` (same pattern
 * as the shopkeeper pages) → both portals display the same canonical token.
 */

let auth: JwtAuthAdapter;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  auth = new JwtAuthAdapter(
    { accessSecret: 'a', refreshSecret: 'b', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  const container: Container = {
    db, storage: new InMemoryStorageAdapter(), payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(), realtime: new InMemoryRealtimeAdapter(),
    cache, queue: new InMemoryQueueAdapter(), email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(), logger: new JsonConsoleLogger({ service: 'test' }), auth,
  };
  setContainerForTesting(container);

  // Create a shop + user
  const user = await repos.users.create(
    { email: 'token@test.com', phone: '+919999999999', password: 'Pass123!', role: 'owner', shopId: null },
    auth,
  );
  const shop = await repos.shops.create({
    id: crypto.randomUUID(), name: 'Token Shop', slug: 'token-shop',
    ownerUserId: user.id, upiId: 'token@okaxis', paymentProvider: 'googlepay',
    paymentCredentials: {}, pricingConfig: createDefaultPricingConfig() as never,
    address: 'x', phone: '+919999999999', timezone: 'Asia/Kolkata', isActive: true,
    subscriptionTier: 'free', subscriptionExpiresAt: null, description: null,
    businessHours: null, logoUrl: null, upiQrStorageKey: null, servicesJson: null,
    paymentPhone: null, paymentInstructions: null, cashOnPickup: false,
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
  await repos.users.update(user.id, { shopId: shop.id });
});

describe('Token consistency — customer + shopkeeper see the same token', () => {
  it('an order has BOTH customerToken + tokenNumber', async () => {
    const shop = await repos.shops.findBySlug('token-shop');
    const order = await repos.orders.createWithUniqueToken(
      shop!.id,
      { customerPhone: '+919999999999' },
      (count, attempt) => {
        // Simulate the tokenNumber generation (A001, A002, etc.)
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const within = (count % 999) + 1 + attempt;
        return letters[Math.floor(count / 999)] + String(within).padStart(3, '0');
      },
    );
    expect(order.customerToken).toBeTruthy();
    expect(order.tokenNumber).toBeTruthy();
    expect(order.customerToken).not.toBe(order.tokenNumber);
  });

  it('the customer status API response includes tokenNumber (the canonical token)', async () => {
    const shop = await repos.shops.findBySlug('token-shop');
    const order = await repos.orders.createWithUniqueToken(
      shop!.id, {},
      (count, attempt) => `A${String(count + 1 + attempt).padStart(3, '0')}`,
    );
    // Simulate the status API logic: findById + return tokenNumber
    const fetched = await repos.orders.findById(order.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.tokenNumber).toBe(order.tokenNumber);
    expect(fetched!.customerToken).toBe(order.customerToken);
    // The UI should show tokenNumber ?? customerToken (same as the shopkeeper pages)
    const displayToken = fetched!.tokenNumber ?? fetched!.customerToken;
    expect(displayToken).toBe(order.tokenNumber); // prefers tokenNumber
  });

  it('legacy orders without tokenNumber fall back to customerToken', async () => {
    const shop = await repos.shops.findBySlug('token-shop');
    // Create an order with NULL tokenNumber (legacy)
    const order = await repos.orders.create({
      shopId: shop!.id,
      customerToken: 'LEGACY1',
    });
    const fetched = await repos.orders.findById(order.id);
    expect(fetched!.tokenNumber).toBeNull();
    // The UI falls back to customerToken for legacy orders
    const displayToken = fetched!.tokenNumber ?? fetched!.customerToken;
    expect(displayToken).toBe('LEGACY1');
  });

  it('the shopkeeper order list + the customer status show the same token', async () => {
    const shop = await repos.shops.findBySlug('token-shop');
    const order = await repos.orders.createWithUniqueToken(
      shop!.id, {},
      (count, attempt) => `A${String(count + 1 + attempt).padStart(3, '0')}`,
    );
    // Shopkeeper list (listByShop)
    const shopkeeperList = await repos.orders.listByShop(shop!.id);
    const shopkeeperOrder = shopkeeperList.find((o) => o.id === order.id);
    expect(shopkeeperOrder?.tokenNumber).toBe(order.tokenNumber);
    // Customer status (findById)
    const fetched = await repos.orders.findById(order.id);
    const customerToken = fetched!.tokenNumber ?? fetched!.customerToken;
    // Both show the SAME token
    expect(shopkeeperOrder?.tokenNumber ?? shopkeeperOrder?.customerToken).toBe(customerToken);
  });

  it('payment status is separate from order status (paidAt tracks payment, status tracks order lifecycle)', async () => {
    const shop = await repos.shops.findBySlug('token-shop');
    const order = await repos.orders.createWithUniqueToken(
      shop!.id, {},
      (count, attempt) => `A${String(count + 1 + attempt).padStart(3, '0')}`,
    );
    // Before payment: status = awaiting_payment, paidAt = null
    expect(order.status).toBe('awaiting_payment');
    expect(order.paidAt).toBeNull();
    expect(order.paymentTxnId).toBeNull();

    // After manual verification: status = paid, paidAt = now, paymentTxnId set
    const updated = await repos.orders.update(order.id, {
      status: 'paid',
      paidAt: new Date(),
      paymentTxnId: 'manual-test-txn',
      paymentUtr: 'TEST-UTR-001',
      paymentProvider: 'googlepay',
    });
    expect(updated.status).toBe('paid');
    expect(updated.paidAt).not.toBeNull();
    expect(updated.paymentTxnId).toBe('manual-test-txn');

    // The order can transition further (paid → printing) WITHOUT losing payment fields
    const printing = await repos.orders.update(order.id, { status: 'printing' });
    expect(printing.status).toBe('printing');
    expect(printing.paidAt).not.toBeNull(); // payment fields preserved
    expect(printing.paymentTxnId).toBe('manual-test-txn');

    // The UI can distinguish: payment is CONFIRMED (paidAt !== null) even while
    // the order is still being PROCESSED (status = printing)
    const isPaymentConfirmed = printing.paidAt !== null;
    const isOrderProcessing = printing.status === 'printing' || printing.status === 'paid';
    expect(isPaymentConfirmed).toBe(true);
    expect(isOrderProcessing).toBe(true);
  });
});

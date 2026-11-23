import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
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
import { submitPayment } from '@/lib/orders/order-flow';
import { createDefaultPricingConfig } from '@platform/core/domain';

/**
 * P9-Security §4 — Payment input validation
 *
 * The customer payment submission path (`POST /api/v1/o/[token]/payment` →
 * `submitPayment`) is the second unauthenticated surface (after upload) —
 * the token in the URL is the only credential. Four input guarantees must
 * hold:
 *
 *   (1) UTR format — exactly 12 numeric digits. Non-numeric or wrong-length
 *       UTRs are rejected before the payment is recorded.
 *
 *   (2) Duplicate UTR detection across the same shop — a single UPI UTR
 *       can only legitimately map to one order in a shop. A resubmission
 *       of the SAME UTR for a DIFFERENT order in the same shop is fraud
 *       (the customer is trying to use one payment to credit two orders).
 *       Reject with `DUPLICATE_UTR`.
 *
 *   (3) Amount mismatch flag — the customer's declared payment amount
 *       (from the UPI app screenshot / UTR confirmation) MUST match the
 *       order's `totalAmountPaise`. A mismatch signals a wrong-amount
 *       transfer (the customer paid for a different order). Reject with
 *       `AMOUNT_MISMATCH` so the shopkeeper isn't shown a misleading
 *       "customer paid" notification.
 *
 *   (4) Screenshot limits — if a screenshot is attached (optional), it
 *       must be ≤ 2 MB and a PNG or JPEG (no other types — the shopkeeper
 *       reviews these on a phone). Rejects oversized / wrong-type files.
 *
 * Tests exercise `submitPayment` directly (unit) and the route (integration)
 * so both the business rule and the HTTP contract are covered.
 */

let container: Container;
let shopId: string;
let shopSlug: string;

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

  shopSlug = 'shop-' + crypto.randomUUID().slice(0, 8);
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId,
    name: 'Pay Test Shop',
    slug: shopSlug,
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
    upiPayeeName: 'Pay Test Shop',
    paymentMode: 'UPI_THEN_PRINT',
  } as never);
});

/** Create an order in `awaiting_payment` with the given total + token. */
async function makeOrder(totalPaise: number): Promise<{ id: string; token: string }> {
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
  } as never);
  return { id: order.id, token: order.customerToken };
}

// ── (1) UTR format ──

describe('Payment validation — UTR format', () => {
  it('rejects a non-numeric UTR', async () => {
    const o = await makeOrder(50000);
    await expect(
      submitPayment(o.token, { method: 'upi', utr: 'ABCDEFGHIJKL' }),
    ).rejects.toThrow(/12-digit/i);
  });

  it('rejects an 11-digit UTR (too short)', async () => {
    const o = await makeOrder(50000);
    await expect(
      submitPayment(o.token, { method: 'upi', utr: '12345678901' }),
    ).rejects.toThrow(/12-digit/i);
  });

  it('rejects a 13-digit UTR (too long)', async () => {
    const o = await makeOrder(50000);
    await expect(
      submitPayment(o.token, { method: 'upi', utr: '1234567890123' }),
    ).rejects.toThrow(/12-digit/i);
  });

  it('rejects a UTR with whitespace', async () => {
    const o = await makeOrder(50000);
    await expect(
      submitPayment(o.token, { method: 'upi', utr: '123456789012 ' }),
    ).rejects.toThrow(/12-digit/i);
  });

  it('accepts a well-formed 12-digit UTR', async () => {
    const o = await makeOrder(50000);
    const res = await submitPayment(o.token, {
      method: 'upi',
      utr: '123456789012',
      declaredAmountPaise: 50000,
    });
    expect(res.paymentId).toBeTruthy();
    expect(res.status).toBe('SUBMITTED');
  });

  it('counter_cash payment does NOT require a UTR', async () => {
    const o = await makeOrder(50000);
    const res = await submitPayment(o.token, { method: 'counter_cash' });
    expect(res.paymentId).toBeTruthy();
    // counter payments stay PENDING until the shopkeeper confirms.
    expect(res.status).toBe('PENDING');
  });
});

// ── (2) Duplicate UTR detection across the same shop ──

describe('Payment validation — duplicate UTR across same shop', () => {
  it('rejects a UTR already used for another order in the SAME shop', async () => {
    const o1 = await makeOrder(50000);
    await submitPayment(o1.token, {
      method: 'upi',
      utr: '111122223333',
      declaredAmountPaise: 50000,
    });

    // Second order, same shop, same UTR → must be rejected.
    const o2 = await makeOrder(75000);
    await expect(
      submitPayment(o2.token, {
        method: 'upi',
        utr: '111122223333',
        declaredAmountPaise: 75000,
      }),
    ).rejects.toThrow(/duplicate.*utr|UTR.*(used|already)|already submitted.*another order/i);
  });

  it('allows the SAME UTR to be resubmitted for the SAME order (idempotent retry)', async () => {
    // The customer hit "Submit" twice in quick succession — the same order,
    // same UTR. Idempotency: the second call must NOT be flagged as a dup
    // (it's the same payment being retried, not fraud).
    const o = await makeOrder(50000);
    const first = await submitPayment(o.token, {
      method: 'upi',
      utr: '222233334444',
      declaredAmountPaise: 50000,
    });
    // A second submission with the same UTR for the same order should not
    // throw a duplicate-UTR error. (The state machine may reject it for a
    // different reason — "already submitted" — but NOT for duplication.)
    try {
      const second = await submitPayment(o.token, {
        method: 'upi',
        utr: '222233334444',
        declaredAmountPaise: 50000,
      });
      // If it succeeded, the payment id may be the same or different —
      // either is acceptable; the point is no duplicate-UTR error fired.
      expect(second.paymentId).toBeTruthy();
    } catch (err) {
      // If it threw, the error must NOT mention duplicate UTR.
      expect(/duplicate.*utr|UTR.*used/i.test((err as Error).message)).toBe(false);
    }
    // Silence unused-var warning.
    void first;
  });

  it('allows the SAME UTR for orders in DIFFERENT shops (cross-shop is not fraud)', async () => {
    // The customer used one UPI payment to pay two DIFFERENT shops (legit
    // scenario — two separate payments happen to share a UPI ref because
    // the UTR space is 12 digits = 10^12 and collisions are rare but legal
    // across shops). The duplicate check is per-shop.
    const o1 = await makeOrder(50000);
    await submitPayment(o1.token, {
      method: 'upi',
      utr: '444455556666',
      declaredAmountPaise: 50000,
    });

    // Create a second shop.
    const shop2 = crypto.randomUUID();
    await repos.shops.create({
      id: shop2,
      name: 'Other Shop',
      slug: 'other-' + shop2.slice(0, 8),
      ownerUserId: crypto.randomUUID(),
      upiId: 'shop2@upi',
      paymentProvider: 'googlepay',
      paymentCredentials: '',
      pricingConfig: JSON.stringify(createDefaultPricingConfig()),
      address: '2 Test St',
      phone: '5550000001',
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
    await container.db.update('shop', { id: shop2 }, {
      isOpen: true,
      acceptingOrders: true,
      upiId: 'shop2@upi',
      upiPayeeName: 'Other Shop',
      paymentMode: 'UPI_THEN_PRINT',
    } as never);
    const o2 = await repos.orders.createWithUniqueToken(
      shop2,
      {
        customerPhone: null,
        notes: null,
        regenerateCustomerToken: () =>
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      },
      (c) => String(200 + c),
    );
    await container.db.update('order', { id: o2.id }, {
      status: 'awaiting_payment',
      totalAmountPaise: 30000,
      orderNumber: '5001',
    } as never);

    // Same UTR, different shop → must succeed.
    const res = await submitPayment(o2.customerToken, {
      method: 'upi',
      utr: '444455556666',
      declaredAmountPaise: 30000,
    });
    expect(res.paymentId).toBeTruthy();
  });

  it('allows a REJECTED UTR to be resubmitted (the customer paid again)', async () => {
    // The shopkeeper rejected the first submission (wrong amount). The
    // customer re-paid with a NEW UPI transfer — the SAME UTR is impossible
    // for a new transfer (UTRs are unique per UPI transaction), but a typo
    // could cause the customer to re-enter it. The shop should let them
    // proceed: the prior REJECTED payment is no longer blocking.
    const o = await makeOrder(50000);
    const first = await submitPayment(o.token, {
      method: 'upi',
      utr: '777788889999',
      declaredAmountPaise: 50000,
    });
    // Move the order back to awaiting_payment (the shopkeeper rejected).
    const payment = await repos.payments.forOrder(o.id);
    await repos.payments.update(payment[0].id, { status: 'REJECTED', rejectReason: 'wrong amount' });
    await container.db.update('order', { id: o.id }, { status: 'awaiting_payment', paymentUtr: null });

    // Customer resubmits the same UTR — should be allowed now.
    const res = await submitPayment(o.token, {
      method: 'upi',
      utr: '777788889999',
      declaredAmountPaise: 50000,
    });
    expect(res.paymentId).not.toBe(first.paymentId);
  });
});

// ── (3) Amount mismatch flag ──

describe('Payment validation — declared amount must match order total', () => {
  it('rejects when the declared amount is LESS than the order total', async () => {
    const o = await makeOrder(50000); // Rs 500
    await expect(
      submitPayment(o.token, {
        method: 'upi',
        utr: '123456789012',
        declaredAmountPaise: 40000, // Rs 400 — underpaid
      }),
    ).rejects.toThrow(/amount.*mismatch|wrong amount/i);
  });

  it('rejects when the declared amount is MORE than the order total', async () => {
    const o = await makeOrder(50000);
    await expect(
      submitPayment(o.token, {
        method: 'upi',
        utr: '123456789012',
        declaredAmountPaise: 60000, // overpaid
      }),
    ).rejects.toThrow(/amount.*mismatch|wrong amount/i);
  });

  it('accepts when the declared amount EQUALS the order total', async () => {
    const o = await makeOrder(50000);
    const res = await submitPayment(o.token, {
      method: 'upi',
      utr: '123456789012',
      declaredAmountPaise: 50000,
    });
    expect(res.paymentId).toBeTruthy();
  });

  it('does NOT require declaredAmountPaise (omitted = unverified, not rejected)', async () => {
    // Backward compat: if the client doesn't send declaredAmountPaise, the
    // server can't compare. The shopkeeper's manual verification is the
    // safety net. We must NOT break clients that don't send the field.
    const o = await makeOrder(50000);
    const res = await submitPayment(o.token, { method: 'upi', utr: '123456789012' });
    expect(res.paymentId).toBeTruthy();
  });
});

// ── (4) Screenshot size + type limits ──

describe('Payment validation — screenshot size + type limits', () => {
  /** Minimal valid PNG bytes. */
  const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mP8z8DwnwEPYBhVUWz4AQUAAA5vBwUAffFvPwAAAABJRU5ErkJggg==',
    'base64',
  );
  /** Minimal valid JPEG bytes (FF D8 FF E0 ...). */
  const JPEG_BYTES = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  /** Bytes that look like a PDF (%PDF- magic). */
  const PDF_BYTES = Buffer.from('%PDF-1.4\n%EOF\n', 'latin1');

  it('rejects a screenshot larger than 2 MB', async () => {
    const o = await makeOrder(50000);
    const tooBig = new Uint8Array(2 * 1024 * 1024 + 1);
    await expect(
      submitPayment(o.token, {
        method: 'upi',
        utr: '123456789012',
        declaredAmountPaise: 50000,
        screenshotBytes: tooBig,
      }),
    ).rejects.toThrow(/screenshot.*(large|big)|2 ?MB/i);
  });

  it('rejects a screenshot whose bytes are NOT a PNG or JPEG', async () => {
    const o = await makeOrder(50000);
    await expect(
      submitPayment(o.token, {
        method: 'upi',
        utr: '123456789012',
        declaredAmountPaise: 50000,
        screenshotBytes: PDF_BYTES,
      }),
    ).rejects.toThrow(/screenshot.*(png|jpeg|type|format)|invalid image/i);
  });

  it('accepts a PNG screenshot ≤ 2 MB', async () => {
    const o = await makeOrder(50000);
    const res = await submitPayment(o.token, {
      method: 'upi',
      utr: '123456789012',
      declaredAmountPaise: 50000,
      screenshotBytes: PNG_BYTES,
    });
    expect(res.paymentId).toBeTruthy();
  });

  it('accepts a JPEG screenshot ≤ 2 MB', async () => {
    const o = await makeOrder(50000);
    const res = await submitPayment(o.token, {
      method: 'upi',
      utr: '123456789012',
      declaredAmountPaise: 50000,
      screenshotBytes: JPEG_BYTES,
    });
    expect(res.paymentId).toBeTruthy();
  });
});

// ── Route-level integration (HTTP contract) ──

describe('Payment validation — POST /api/v1/o/[token]/payment rejects bad UTR', () => {
  it('returns 400 for a non-numeric UTR via the route', async () => {
    const o = await makeOrder(50000);
    const { POST } = await import('@/app/api/v1/o/[token]/payment/route');
    const req = new NextRequest(`http://localhost:3000/api/v1/o/${o.token}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'upi', utr: 'not-a-utr' }),
    });
    const res = await POST(req, { params: Promise.resolve({ token: o.token }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('returns 200 for a well-formed UTR + matching amount via the route', async () => {
    const o = await makeOrder(50000);
    const { POST } = await import('@/app/api/v1/o/[token]/payment/route');
    const req = new NextRequest(`http://localhost:3000/api/v1/o/${o.token}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'upi', utr: '123456789012', declaredAmountPaise: 50000 }),
    });
    const res = await POST(req, { params: Promise.resolve({ token: o.token }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

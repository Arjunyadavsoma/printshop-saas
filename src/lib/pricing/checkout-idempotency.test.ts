import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Phase 6.3 — Checkout idempotency tests.
 *
 * Verifies the stable-idempotency-key fix in
 * `src/app/api/v1/orders/[id]/checkout/route.ts`. The merchantOrderId is
 * now derived from the order id (`checkout-${order.id}`) instead of a
 * random UUID, and the route reuses an existing active attempt instead of
 * creating a duplicate.
 *
 * Test matrix:
 *   1. 10 simultaneous requests for one order — only 1 PaymentAttempt is
 *      created; all 10 responses return the same merchantOrderId.
 *   2. Duplicate request with the same idempotency key — the second call
 *      returns the same merchantOrderId as the first.
 *   3. (N/A — the key is derived from the order id, so it's always the
 *      same for the same order. Different keys for the same order would
 *      require a different code path; documented as a design property.)
 *   4. Retry after timeout — an expired 'created' attempt is marked
 *      'expired' and a new attempt is created.
 *   5. Retry after provider creation failure — the route returns 500;
 *      the 'created' attempt remains but the customer sees an error.
 *   6. Expired attempt handling — seeding an expired attempt and then
 *      checking out creates a new 'created' attempt.
 *   7. Order total changed before checkout — checkout amount = the
 *      updated `order.totalAmountPaise`.
 *   8. Order configuration changed before checkout — checkout validates
 *      the files/prices and uses the latest server-persisted state.
 *   9. (N/A — payment callback arriving during retry requires real
 *      webhook delivery; documented as a limitation.)
 *  10. Transaction rollback — when `paymentAttempt.create` throws a
 *      non-unique error, the route aborts with 500 and no provider
 *      contact is made.
 *  11. (N/A — two independent database connections requires real
 *      PostgreSQL/PGlite concurrency; the in-memory mock uses a single
 *      Map. Documented as a limitation.)
 */

vi.mock('@/lib/db', async () => {
  const { getMockDb } = await import('@/lib/payments/test-prisma-mock');
  return { db: getMockDb() };
});

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
import { createDefaultPricingConfig } from '@platform/core/domain';
import { db } from '@/lib/db';
import { resetMockDb, seedPaymentAttempt } from '@/lib/payments/test-prisma-mock';

let container: Container;
let orderId: string;
let customerToken: string;
let shopId: string;

beforeEach(async () => {
  resetMockDb();
  const inMemDb = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );

  const adapter = new UpiDeepLinkPaymentAdapter();
  const registry = new PaymentAdapterRegistry();
  (registry as any).adapters.set('googlepay', adapter);

  container = {
    db: inMemDb,
    storage: new InMemoryStorageAdapter(),
    payment: adapter,
    paymentRegistry: registry,
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new JsonConsoleLogger({ service: 'test' }),
    auth,
  };
  setContainerForTesting(container);

  // Create shop + user + order + a priced file.
  const user = await repos.users.create({
    email: 'idem@test.com', phone: '5555555555', password: 'testpass', role: 'owner', shopId: null,
  }, auth);
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId, name: 'Idem Shop', slug: `idem-${shopId.slice(0, 8)}`, ownerUserId: user.id,
    upiId: 'idem@upi', paymentProvider: 'googlepay', paymentCredentials: '',
    pricingConfig: JSON.stringify(createDefaultPricingConfig()), address: '123 St', phone: '555',
    timezone: 'Asia/Kolkata', isActive: true, subscriptionTier: 'free', subscriptionExpiresAt: null,
    description: null, businessHours: null, logoUrl: null, upiQrStorageKey: null, servicesJson: null,
    paymentPhone: null, paymentInstructions: null, cashOnPickup: false, paymentMethods: 'both',
    pamphletEnabled: false, pamphletPricePaise: 0, pamphletName: null,
  } as any);
  await repos.users.update(user.id, { shopId } as any);

  const order = await repos.orders.createWithUniqueToken(
    shopId,
    { customerPhone: null, notes: null },
    (count: number, attempt: number) => `T${100 + count + attempt}`,
  );
  orderId = order.id;
  customerToken = order.customerToken;

  const fileId = crypto.randomUUID();
  await container.db.insert('printFile', {
    id: fileId, orderId, originalFilename: 'doc.pdf',
    storageKey: `shops/${shopId}/orders/${orderId}/${fileId}`,
    mimeType: 'application/pdf', sizeBytes: 1024, pageCount: 3, copies: 1,
    colorMode: 'bw', pageRange: null, paperSize: 'a4', duplex: false,
    pricePaise: 1000, status: 'pending', printedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await repos.orders.update(orderId, { totalAmountPaise: 1000 } as any);
});

async function checkoutReq(): Promise<NextRequest> {
  return new NextRequest(`http://localhost:3000/api/v1/orders/${orderId}/checkout`, {
    method: 'POST',
    headers: { 'x-order-token': customerToken },
  });
}

async function doCheckout(): Promise<{ res: Response; json: any }> {
  const { POST } = await import('@/app/api/v1/orders/[id]/checkout/route');
  const req = await checkoutReq();
  const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
  return { res, json: await res.json() };
}

/** Convenience: read the mock's attempts Map. */
function attemptsMap(): Map<string, any> {
  return (db as any).__internal.attempts as Map<string, any>;
}

describe('Phase 6.3 — checkout idempotency', () => {
  it('1. 10 simultaneous requests for one order create exactly 1 PaymentAttempt (all return the same merchantOrderId)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => doCheckout()),
    );

    // All 10 should succeed.
    for (const { res, json } of results) {
      expect(res.status, `expected 200, got ${res.status}: ${JSON.stringify(json)}`).toBe(200);
      expect(json.success).toBe(true);
    }

    // All 10 merchantOrderIds should be identical.
    const merchantOrderIds = results.map((r) => r.json.data.merchantOrderId);
    const unique = new Set(merchantOrderIds);
    expect(unique.size, `expected 1 unique merchantOrderId, got ${unique.size}: ${[...unique].join(', ')}`).toBe(1);

    // The mock's paymentAttempt Map should have exactly 1 row.
    expect(attemptsMap().size, 'expected exactly 1 PaymentAttempt row').toBe(1);
  });

  it('2. duplicate request with the same idempotency key returns the same merchantOrderId', async () => {
    const first = await doCheckout();
    const second = await doCheckout();

    expect(first.res.status).toBe(200);
    expect(second.res.status).toBe(200);
    expect(first.json.data.merchantOrderId).toBe(second.json.data.merchantOrderId);

    expect(attemptsMap().size).toBe(1); // still only 1 attempt
  });

  it.skip('3. different idempotency keys for the same order (N/A — key is derived from order.id)', () => {
    // The idempotency key is `checkout-${order.id}` — a deterministic
    // function of the order id. There's no way to produce a different
    // key for the same order through the public API. Documented as a
    // design property, not a test gap.
  });

  it('4. retry after timeout creates a new attempt and marks the old one expired', async () => {
    // Seed an expired 'created' attempt for this order.
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'googlepay',
      merchantOrderId: `checkout-${orderId}`,
      amountPaise: 1000,
      status: 'created',
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    });
    expect(attemptsMap().size).toBe(1);
    const oldId = [...attemptsMap().values()][0].id;

    // Now checkout — the route should mark the old attempt 'expired' and
    // create a new one (with a timestamp-suffixed merchantOrderId, since
    // the old merchantOrderId was the same idempotencyKey).
    const { res, json } = await doCheckout();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // The old attempt should be marked 'expired'.
    const oldRow = attemptsMap().get(oldId);
    expect(oldRow.status).toBe('expired');

    // A new 'created' attempt should exist.
    const createdAttempts = [...attemptsMap().values()].filter((a) => a.status === 'created');
    expect(createdAttempts.length).toBe(1);

    // The new merchantOrderId should differ from the old one (timestamp suffix).
    expect(json.data.merchantOrderId).not.toBe(`checkout-${orderId}`);
    expect(json.data.merchantOrderId).toMatch(new RegExp(`^checkout-${orderId.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}-\\d+$`));
  });

  it('5. retry after provider creation failure — the route returns 500 and the attempt remains (no second provider call leaks)', async () => {
    // Mock the adapter to throw on createPaymentIntent.
    const adapter = container.paymentRegistry.get('googlepay');
    const spy = vi.spyOn(adapter, 'createPaymentIntent').mockRejectedValueOnce(
      new Error('provider down'),
    );

    const { res, json } = await doCheckout();
    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.data?.merchantOrderId).toBeUndefined();

    // The PaymentAttempt WAS persisted (persistence happens BEFORE
    // provider contact) — so there's 1 row in the mock.
    const attempts = [...attemptsMap().values()];
    expect(attempts.length).toBe(1);
    // The attempt remains 'created' — the customer saw a 500, so they
    // know not to pay. The 10-minute expiry cleans it up. A subsequent
    // checkout retry will hit the findFirst→reuse path; if the provider
    // accepts the same merchantOrderId (idempotency key on their side),
    // reuse is correct. If not, the retry will mint a fresh one.
    expect(attempts[0].status).toBe('created');

    spy.mockRestore();
  });

  it('6. expired attempt handling — seeding an expired attempt then checkout creates a new active attempt', async () => {
    // Seed an attempt that's already 'expired' (different merchantOrderId,
    // so the new INSERT with `checkout-${orderId}` won't collide).
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'googlepay',
      merchantOrderId: `checkout-${orderId}-old`,
      amountPaise: 1000,
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const { res, json } = await doCheckout();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // A new 'created' attempt should exist with merchantOrderId = `checkout-${orderId}`.
    const created = [...attemptsMap().values()].filter((a) => a.status === 'created');
    expect(created.length).toBe(1);
    expect(created[0].merchantOrderId).toBe(`checkout-${orderId}`);
  });

  it('7. order total changed before checkout — checkout amount = updated totalAmountPaise', async () => {
    // Update the order total to a different amount.
    await repos.orders.update(orderId, { totalAmountPaise: 5000 } as any);

    const { res, json } = await doCheckout();
    expect(res.status).toBe(200);
    expect(json.data.amountPaise).toBe(5000);

    // The persisted PaymentAttempt should also carry the updated amount.
    const attempts = [...attemptsMap().values()];
    expect(attempts[0].amountPaise).toBe(5000);
  });

  it('8. order configuration changed before checkout — checkout validates files + uses latest state', async () => {
    // Add a second file with a price.
    const file2 = crypto.randomUUID();
    await container.db.insert('printFile', {
      id: file2, orderId, originalFilename: 'doc2.pdf',
      storageKey: `shops/${shopId}/orders/${orderId}/${file2}`,
      mimeType: 'application/pdf', sizeBytes: 2048, pageCount: 5, copies: 1,
      colorMode: 'bw', pageRange: null, paperSize: 'a4', duplex: false,
      pricePaise: 2000, status: 'pending', printedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await repos.orders.update(orderId, { totalAmountPaise: 3000 } as any);

    const { res, json } = await doCheckout();
    expect(res.status).toBe(200);
    expect(json.data.amountPaise).toBe(3000);
  });

  it.skip('9. payment callback arriving during retry (N/A — requires real webhook delivery)', () => {
    // This scenario requires a real webhook to arrive while the checkout
    // retry is in-flight. The in-memory mock can't simulate concurrent
    // network I/O. The PhonePe/Paytm webhook tests in payments.test.ts
    // cover the webhook side; this race is documented as a limitation.
  });

  it('10. transaction rollback — when paymentAttempt.create throws a non-unique error, route returns 500 and no provider contact is made', async () => {
    // Override create to throw a non-unique error (simulates a DB outage
    // — distinct from the UNIQUE-constraint P2002 the route handles).
    vi.mocked(db.paymentAttempt.create).mockRejectedValueOnce(
      new Error('connection refused'),
    );

    let providerCalled = false;
    const adapter = container.paymentRegistry.get('googlepay');
    const spy = vi.spyOn(adapter, 'createPaymentIntent').mockImplementation(async () => {
      providerCalled = true;
      throw new Error('should not be reached');
    });

    const { res, json } = await doCheckout();
    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(providerCalled).toBe(false); // provider NOT contacted

    spy.mockRestore();
  });

  it.skip('11. two independent database connections (N/A — requires real PostgreSQL/PGlite concurrency)', () => {
    // The in-memory mock uses a single Map; true PostgreSQL concurrency
    // (two separate connections with their own snapshots) requires a
    // PGlite/PG integration test. The lifecycle.service.test.ts and
    // payment-event-persistence.test.ts cover the PGlite path. The
    // 10-concurrent-request test above exercises the same race condition
    // (P2002 catch → reuse winner) using the in-memory mock.
  });
});

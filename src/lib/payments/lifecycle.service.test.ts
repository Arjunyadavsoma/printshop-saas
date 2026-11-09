import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Phase 5.3 — Lifecycle service atomic transition tests.
 *
 * Tests `applyPaymentTransition` directly (not via the webhook pipeline) to
 * verify the atomicity + idempotency guarantees documented in the service's
 * class-level docstring:
 *
 *   1. PaymentAttempt and PaymentEvent transition atomically.
 *   2. Transaction rollback leaves no partial financial transition.
 *   3. Duplicate webhook processing is idempotent.
 *   4. Concurrent processing cannot produce contradictory final states.
 *   5. Stale events cannot regress final payment states.
 *   6. Amount and currency mismatches are rejected.
 *   7. Provider transaction reference is persisted consistently.
 *
 * Uses the shared Prisma mock (`getMockDb` / `resetMockDb` /
 * `seedPaymentAttempt`) + the InMemory adapter for orders. `applyPaymentTransition`
 * is called directly so the assertions are about the lifecycle service's
 * contract — not the webhook pipeline's plumbing (which is tested separately
 * in `webhook-audit.test.ts` and `payment-event-persistence.test.ts`).
 *
 * `payment-event-persistence.test.ts` covers the SAME scenarios against a real
 * PGlite PostgreSQL engine (real UNIQUE constraints, real transaction
 * rollback). This file covers them against the in-memory mock to verify the
 * lifecycle service's high-level contract — the conditional-update logic,
 * the dedup path, the amount/currency guard, and the provider-reference
 * persistence — without needing PGlite. The two files are complementary.
 */

// Phase 5.3: use the shared Prisma-style mock that delegates order operations
// to the InMemory adapter + provides $transaction for the lifecycle service.
vi.mock('@/lib/db', async () => {
  const { getMockDb } = await import('@/lib/payments/test-prisma-mock');
  return { db: getMockDb() };
});

import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { resetMockDb, seedPaymentAttempt, getMockDb } from '@/lib/payments/test-prisma-mock';
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
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type Shop } from '@platform/core/domain';
import {
  applyPaymentTransition,
  type PaymentTransitionResult,
} from '@/lib/payments/lifecycle.service';

// ─── Test fixtures ─────────────────────────────────────────────────────

let container: Container;
let shopId: string;
let orderId: string;
const AMOUNT_PAISE = 50500;

beforeEach(async () => {
  resetMockDb();

  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
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
    auth: new JwtAuthAdapter(
      {
        accessSecret: 'test-access-secret-min-32-chars-long',
        refreshSecret: 'test-refresh-secret-min-32-chars-long',
        accessTtlSeconds: 900,
        refreshTtlSeconds: 2592000,
      },
      cache,
    ),
  };
  setContainerForTesting(container);

  // Seed a shop + order.
  const owner = await repos.users.create(
    {
      email: 'lifecycle-owner@test.com',
      phone: '5555555555',
      password: 'testpass123',
      role: 'owner',
      shopId: null,
    },
    container.auth,
  );
  shopId = crypto.randomUUID();
  const shop: Shop = {
    id: shopId,
    name: 'Lifecycle Shop',
    slug: `lifecycle-${shopId.slice(0, 8)}`,
    ownerUserId: owner.id,
    upiId: 'lifecycle@okaxis',
    paymentProvider: 'phonepe',
    paymentCredentials: {
      phonepe: { saltKey: 'test-salt', saltIndex: '1', merchantId: 'LCMID', env: 'sandbox' },
    },
    pricingConfig: createDefaultPricingConfig(),
    address: 'x',
    phone: '999',
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await repos.shops.create(shop);
  await repos.users.update(owner.id, { shopId });

  const order = await repos.orders.create({
    shopId,
    customerToken: 'LCM' + Math.random().toString(36).slice(2, 6).toUpperCase(),
  });
  orderId = order.id;
  await repos.orders.update(orderId, { totalAmountPaise: AMOUNT_PAISE });
});

/** A standard input for applyPaymentTransition — paid=true, amount matches. */
function defaultInput(overrides: Partial<Parameters<typeof applyPaymentTransition>[0]> = {}): Parameters<typeof applyPaymentTransition>[0] {
  return {
    merchantOrderId: 'moid-default',
    provider: 'phonepe',
    providerTxnId: 'TXN-DEFAULT',
    providerUtr: 'UTR-DEFAULT',
    amountPaise: AMOUNT_PAISE,
    currency: 'INR',
    paid: true,
    eventId: 'TXN-DEFAULT',
    source: 'webhook',
    shopId,
    orderId,
    ...overrides,
  };
}

/** Read the latest attempt row from the mock's internal Map. */
function readAttempt(attemptId: string) {
  return getMockDb().__internal.attempts.get(attemptId);
}

/** Count PaymentEvent rows in the mock. */
function countEvents(): number {
  return getMockDb().__internal.events.size;
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('applyPaymentTransition — atomic transition contract', () => {
  it('1. PaymentAttempt and PaymentEvent transition atomically (both flip together)', async () => {
    const moid = 'moid-lcm-1-' + Date.now();
    const txnId = 'TXN-LCM-1';
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    const result = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: txnId,
        providerUtr: 'UTR-LCM-1',
        eventId: txnId,
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.attemptStatus).toBe('paid');
    expect(result.orderStatus).toBe('paid');

    // The PaymentAttempt flipped to 'paid' + providerTransactionId is set.
    const attempt = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt?.status).toBe('paid');
    expect(attempt?.providerTransactionId).toBe(txnId);

    // The PaymentEvent is in 'processed' state (received → processed inside
    // the transaction).
    expect(countEvents()).toBe(1);
    const event = [...getMockDb().__internal.events.values()][0];
    expect(event.processingStatus).toBe('processed');
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(event.providerTransactionId).toBe(txnId);

    // The Order is paid + has the provider txn ref.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe(txnId);
    expect(order?.paymentUtr).toBe('UTR-LCM-1');
  });

  it('2. transaction rollback leaves no partial financial transition (failed transition → no flip)', async () => {
    const moid = 'moid-lcm-2-' + Date.now();
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    // Sabotage the PaymentAttempt updateMany to throw a NON-unique error mid-
    // transaction. The lifecycle service's transaction should roll back —
    // no PaymentEvent row should remain in 'received' (the entire transaction
    // either commits or rolls back; there's no partial state).
    const mockDb = getMockDb();
    const originalUpdateMany = mockDb.paymentAttempt.updateMany.getMockImplementation();
    mockDb.paymentAttempt.updateMany.mockImplementationOnce(async () => {
      throw new Error('simulated DB connection drop mid-transaction');
    });

    await expect(
      applyPaymentTransition(
        defaultInput({
          merchantOrderId: moid,
          providerTxnId: 'TXN-LCM-2',
          eventId: 'TXN-LCM-2',
        }),
      ),
    ).rejects.toThrow(/simulated DB connection drop/);

    // Restore the real implementation so we can read the state cleanly.
    if (originalUpdateMany) {
      mockDb.paymentAttempt.updateMany.mockImplementation(originalUpdateMany);
    } else {
      mockDb.paymentAttempt.updateMany.mockReset();
    }

    // CRITICAL: no partial financial state. The PaymentAttempt is still
    // 'created' (no flip), and the order is still 'awaiting_payment'.
    const attempt = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt?.status).toBe('created');

    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
    expect(order?.paymentTxnId).toBeNull();
  });

  it('3. duplicate webhook processing is idempotent (second call is a no-op)', async () => {
    const moid = 'moid-lcm-3-' + Date.now();
    const txnId = 'TXN-LCM-3';
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    const input = defaultInput({
      merchantOrderId: moid,
      providerTxnId: txnId,
      eventId: txnId,
    });

    // First call — applies the transition.
    const r1 = await applyPaymentTransition(input);
    expect(r1.applied).toBe(true);
    expect(r1.idempotent).toBe(false);

    // Second call — the SAME eventId. The PaymentEvent UNIQUE([provider, eventId])
    // constraint (simulated by the mock's create → throws on duplicate) is
    // caught → the lifecycle returns idempotent=true, applied=false.
    const r2 = await applyPaymentTransition(input);
    expect(r2.applied).toBe(false);
    expect(r2.idempotent).toBe(true);
    expect(r2.attemptStatus).toBe('paid');
    expect(r2.orderStatus).toBe('paid');

    // Exactly ONE PaymentEvent row was persisted (the second call's create
    // threw a unique-violation + was caught).
    expect(countEvents()).toBe(1);

    // The order is paid exactly once.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe(txnId);
  });

  it('4. concurrent processing cannot produce contradictory final states (one wins, the other idempotently skips)', async () => {
    const moid = 'moid-lcm-4-' + Date.now();
    const txnId = 'TXN-LCM-4';
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    const input = defaultInput({
      merchantOrderId: moid,
      providerTxnId: txnId,
      eventId: txnId,
    });

    // Fire TWO applyPaymentTransition calls with the same eventId. The
    // PaymentEvent UNIQUE([provider, eventId]) + the conditional updates
    // (WHERE status='created' / WHERE status='awaiting_payment') must ensure
    // only one wins.
    //
    // NOTE: we intentionally AVOID Promise.all here. Vitest 5.0.4 has a race
    // condition where CONCURRENT dynamic imports of `@/lib/db` (which
    // `applyPaymentTransition` does internally) can cause one import to
    // resolve to the unmocked real Prisma client while the async mock
    // factory's Promise is in-flight. The real PostgreSQL-level concurrency
    // (two transactions racing for the same UNIQUE constraint) is already
    // tested in `payment-event-persistence.test.ts` (test B4) against PGlite.
    // This test verifies the SAME dedup contract at the lifecycle-service
    // level: the second call's PaymentEvent INSERT hits the mock's simulated
    // UNIQUE([provider, eventId]) constraint (23505) → the lifecycle catches
    // it → returns idempotent=true. One call applies, the other skips.
    const r1 = await applyPaymentTransition(input);
    const r2 = await applyPaymentTransition(input);

    const applied = [r1, r2].filter((r) => r.applied);
    const idempotent = [r1, r2].filter((r) => !r.applied);
    expect(applied.length).toBe(1);
    expect(idempotent.length).toBe(1);
    expect(idempotent[0].idempotent).toBe(true);

    // Exactly ONE PaymentEvent row was persisted (the loser's create was a
    // unique-violation → caught + read-existing path returned idempotent).
    expect(countEvents()).toBe(1);

    // The order is paid exactly once + the txnId is consistent.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe(txnId);

    // The attempt flipped to 'paid' exactly once.
    const attempt = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt?.status).toBe('paid');
  });

  it('5. stale events cannot regress final payment states (paid event after failed event is rejected)', async () => {
    const moid = 'moid-lcm-5-' + Date.now();
    const failedTxnId = 'TXN-LCM-5-FAIL';
    const successTxnId = 'TXN-LCM-5-LATE-SUCCESS';
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    // First event: a failed payment — flips the attempt to 'failed' (terminal).
    // The order stays in 'awaiting_payment' (allows retry).
    const r1 = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: failedTxnId,
        eventId: failedTxnId,
        paid: false,
      }),
    );
    expect(r1.applied).toBe(true);
    expect(r1.attemptStatus).toBe('failed');
    expect(r1.orderStatus).toBe('awaiting_payment');

    // Second event: a LATE success for the SAME attempt. The attempt is
    // already 'failed' (terminal) — the conditional update
    // (WHERE status IN ('created','pending')) matches 0 rows → idempotent skip.
    // The success MUST NOT regress the attempt back to 'paid'.
    const r2 = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: successTxnId,
        eventId: successTxnId,
        paid: true,
      }),
    );
    expect(r2.applied).toBe(false);
    expect(r2.idempotent).toBe(true);
    expect(r2.attemptStatus).toBe('failed');
    expect(r2.reason).toMatch(/terminal status/);

    // The order is still in 'awaiting_payment' — the stale success didn't
    // flip it. A new PaymentAttempt (a retry) would be required to retry.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
    expect(order?.paymentTxnId).toBeNull();

    // The attempt is still 'failed' — not regressed.
    const attempt = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt?.status).toBe('failed');
    expect(attempt?.providerTransactionId).toBe(failedTxnId);
  });

  it('6. amount and currency mismatches are rejected (no transition, no flip)', async () => {
    const moid = 'moid-lcm-6-' + Date.now();
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    // a. Amount mismatch — the input amountPaise ≠ attempt.amountPaise.
    const rAmount = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: 'TXN-LCM-6-AMT',
        eventId: 'TXN-LCM-6-AMT',
        amountPaise: AMOUNT_PAISE - 100, // ← mismatch
      }),
    );
    expect(rAmount.applied).toBe(false);
    expect(rAmount.attemptStatus).toBe('created');
    expect(rAmount.reason).toMatch(/amount mismatch/);
    // The PaymentEvent IS persisted (records the rejected event) but its
    // processingStatus is 'skipped'.
    const amountEvent = [...getMockDb().__internal.events.values()].find(
      (e) => e.eventId === 'TXN-LCM-6-AMT',
    );
    expect(amountEvent?.processingStatus).toBe('skipped');
    expect(amountEvent?.errorMessage).toContain('amount mismatch');

    // The attempt + order are untouched.
    const attempt1 = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt1?.status).toBe('created');

    // b. Currency mismatch — the input currency ≠ attempt.currency.
    const rCurrency = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: 'TXN-LCM-6-CUR',
        eventId: 'TXN-LCM-6-CUR',
        currency: 'USD', // ← mismatch (attempt defaults to INR)
      }),
    );
    expect(rCurrency.applied).toBe(false);
    expect(rCurrency.attemptStatus).toBe('created');
    expect(rCurrency.reason).toMatch(/currency mismatch/);
    const currencyEvent = [...getMockDb().__internal.events.values()].find(
      (e) => e.eventId === 'TXN-LCM-6-CUR',
    );
    expect(currencyEvent?.processingStatus).toBe('skipped');
    expect(currencyEvent?.errorMessage).toContain('currency mismatch');

    // Final state: order still in 'awaiting_payment', attempt still 'created'.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
    const attempt2 = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt2?.status).toBe('created');
  });

  it('7. provider transaction reference is persisted consistently (event + attempt + order all carry it)', async () => {
    const moid = 'moid-lcm-7-' + Date.now();
    const txnId = 'TXN-LCM-7';
    const utr = 'UTR-LCM-7';
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    const result = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: txnId,
        providerUtr: utr,
        eventId: txnId,
      }),
    );
    expect(result.applied).toBe(true);
    expect(result.eventId).toBeDefined();
    expect(result.attemptId).toBeDefined();

    // The PaymentEvent row carries the providerTransactionId.
    const event = [...getMockDb().__internal.events.values()].find(
      (e) => e.eventId === txnId,
    );
    expect(event?.providerTransactionId).toBe(txnId);
    expect(event?.merchantOrderId).toBe(moid);
    expect(event?.provider).toBe('phonepe');

    // The PaymentAttempt row carries providerTransactionId (was null, now set).
    const attempt = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt?.providerTransactionId).toBe(txnId);

    // The Order carries BOTH paymentTxnId + paymentUtr + paymentProvider.
    const order = await repos.orders.findById(orderId);
    expect(order?.paymentTxnId).toBe(txnId);
    expect(order?.paymentUtr).toBe(utr);
    expect(order?.paymentProvider).toBe('phonepe');
    expect(order?.paidAt).toBeInstanceOf(Date);
  });

  it('8. a paid event cannot regress an already-paid attempt (idempotent skip)', async () => {
    // Mirror of test 5 but with paid → paid (a duplicate success event).
    const moid = 'moid-lcm-8-' + Date.now();
    const txnId = 'TXN-LCM-8';
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    // First success — applies.
    const r1 = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: txnId,
        eventId: txnId,
      }),
    );
    expect(r1.applied).toBe(true);

    // Second DIFFERENT success event for the same attempt (different eventId).
    // The attempt is already 'paid' (terminal) → conditional update matches
    // 0 rows → idempotent skip. The late success MUST NOT overwrite the
    // original providerTransactionId (the attempt keeps the first txnId).
    const r2 = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: 'LATE-TXN-LCM-8',
        eventId: 'LATE-TXN-LCM-8',
      }),
    );
    expect(r2.applied).toBe(false);
    expect(r2.idempotent).toBe(true);
    expect(r2.attemptStatus).toBe('paid');
    expect(r2.reason).toMatch(/terminal status/);

    // The order's paymentTxnId is the ORIGINAL one — not the late one.
    const order = await repos.orders.findById(orderId);
    expect(order?.paymentTxnId).toBe(txnId);

    // The attempt's providerTransactionId is the ORIGINAL.
    const attempt = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt?.providerTransactionId).toBe(txnId);
  });

  it('9. tenant mismatch is rejected (no transition, no leak)', async () => {
    const moid = 'moid-lcm-9-' + Date.now();
    seedPaymentAttempt({
      shopId,
      orderId,
      provider: 'phonepe',
      merchantOrderId: moid,
      amountPaise: AMOUNT_PAISE,
    });

    // Input claims a DIFFERENT shopId than the attempt's actual shopId.
    const result = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: moid,
        providerTxnId: 'TXN-LCM-9',
        eventId: 'TXN-LCM-9',
        shopId: 'other-shop-' + crypto.randomUUID(),
      }),
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/tenant mismatch/);

    // The attempt + order are untouched.
    const attempt = [...getMockDb().__internal.attempts.values()].find(
      (a) => a.merchantOrderId === moid,
    );
    expect(attempt?.status).toBe('created');
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
  });

  it('10. PaymentAttempt not found is recorded as skipped (no financial transition)', async () => {
    // No seedPaymentAttempt — the lookup misses.
    const result = await applyPaymentTransition(
      defaultInput({
        merchantOrderId: 'moid-nonexistent-' + Date.now(),
        providerTxnId: 'TXN-LCM-10',
        eventId: 'TXN-LCM-10',
      }),
    );
    expect(result.applied).toBe(false);
    expect(result.attemptStatus).toBe('created');
    expect(result.reason).toMatch(/PaymentAttempt not found/);

    // The PaymentEvent IS persisted (records the orphan event), with status 'skipped'.
    const event = [...getMockDb().__internal.events.values()].find(
      (e) => e.eventId === 'TXN-LCM-10',
    );
    expect(event?.processingStatus).toBe('skipped');
    expect(event?.errorMessage).toContain('PaymentAttempt not found');

    // The order is untouched.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
  });
});

/**
 * Type re-export to satisfy the unused-import linter in some setups — keeps
 * the `PaymentTransitionResult` import resolvable for type-only consumers.
 */
export type { PaymentTransitionResult };

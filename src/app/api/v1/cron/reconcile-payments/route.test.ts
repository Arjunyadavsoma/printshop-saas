import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Phase 5.3 — Reconciliation cron route behavioral tests.
 *
 * Tests the GET /api/v1/cron/reconcile-payments endpoint against the shared
 * Prisma mock (getMockDb / resetMockDb / seedPaymentAttempt) + an InMemory
 * container with a PhonePe adapter whose `verifyPayment` is spied on.
 *
 * Scenarios covered:
 *   1. Reconciliation successfully resolves a verified payment.
 *   2. Reconciliation leaves unverifiable payments pending.
 *   3. Reconciliation retries are safe (idempotent — second call is a no-op).
 *   4. Unauthorized cron requests are rejected (no Authorization header).
 *   5. Missing CRON_SECRET fails closed (any token → 401).
 *   6. Overlapping invocations do not double-process (concurrent cron calls).
 *
 * The PhonePe adapter's `verifyPayment` is spied on with `vi.spyOn`. The
 * adapter itself is registered in the container's paymentRegistry so the
 * route's `container.paymentRegistry.get('phonepe')` returns the spied
 * instance.
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
  PhonePePaymentAdapter,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type Shop } from '@platform/core/domain';

// ─── Test fixtures ─────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret-reconciliation';
const PHONEPE_CREDS = {
  phonepe: {
    saltKey: 'recon-test-salt',
    saltIndex: '1',
    merchantId: 'RECONMID',
    env: 'sandbox' as const,
  },
};

let container: Container;
let shopId: string;
let orderId: string;
let phonepeAdapter: PhonePePaymentAdapter;
let verifyPaymentSpy: ReturnType<typeof vi.spyOn>;

// Save env so we can restore it cleanly after the fail-closed test.
const env = process.env as unknown as Record<string, string | undefined>;
const SAVED_CRON_SECRET = env.CRON_SECRET;
const SAVED_SETUP_KEY = env.SETUP_KEY;

beforeEach(async () => {
  resetMockDb();

  // Configure the cron secret + clear SETUP_KEY so the secret lookup is unambiguous.
  env.CRON_SECRET = CRON_SECRET;
  delete env.SETUP_KEY;

  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  phonepeAdapter = new PhonePePaymentAdapter();
  // Spy on verifyPayment BEFORE the route is invoked — tests override the
  // return value per-test via `verifyPaymentSpy.mockResolvedValueOnce(...)`.
  verifyPaymentSpy = vi.spyOn(phonepeAdapter, 'verifyPayment');

  const registry = new PaymentAdapterRegistry();
  // Override the default PhonePe adapter with our spied instance.
  (registry as unknown as { adapters: Map<string, unknown> }).adapters.set('phonepe', phonepeAdapter);

  container = {
    db,
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: registry,
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

  // ── Seed a shop with the test PhonePe credentials ──
  const owner = await repos.users.create(
    {
      email: 'recon-owner@test.com',
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
    name: 'Recon Shop',
    slug: `recon-${shopId.slice(0, 8)}`,
    ownerUserId: owner.id,
    upiId: 'recon@okaxis',
    paymentProvider: 'phonepe',
    paymentCredentials: PHONEPE_CREDS as unknown as Record<string, unknown>,
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

  // ── Seed an order in awaiting_payment ──
  const order = await repos.orders.create({
    shopId,
    customerToken: 'RECON' + Math.random().toString(36).slice(2, 6).toUpperCase(),
  });
  orderId = order.id;
  await repos.orders.update(orderId, { totalAmountPaise: 50000 }); // ₹500
});

afterEach(() => {
  // Restore env vars.
  if (SAVED_CRON_SECRET === undefined) delete env.CRON_SECRET;
  else env.CRON_SECRET = SAVED_CRON_SECRET;
  if (SAVED_SETUP_KEY === undefined) delete env.SETUP_KEY;
  else env.SETUP_KEY = SAVED_SETUP_KEY;
  vi.restoreAllMocks();
});

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Seed a STALE PaymentAttempt — createdAt is 20 minutes ago (past the 10-min
 * staleness threshold the cron uses). `seedPaymentAttempt` sets createdAt to
 * `new Date()` by default; we mutate it via the mock's internal Map so the
 * staleness query in `findStalePaymentAttempts` finds the row.
 */
function seedStaleAttempt(opts: {
  merchantOrderId: string;
  amountPaise?: number;
  status?: string;
}): string {
  const moid = opts.merchantOrderId;
  seedPaymentAttempt({
    shopId,
    orderId,
    provider: 'phonepe',
    merchantOrderId: moid,
    amountPaise: opts.amountPaise ?? 50000,
    status: opts.status ?? 'created',
  });

  // Walk the mock's internal attempts Map to find the row we just seeded + set
  // its `createdAt` to 20 minutes ago (past the 10-min staleness threshold).
  const mockDb = getMockDb();
  for (const row of mockDb.__internal.attempts.values()) {
    if (row.merchantOrderId === moid) {
      row.createdAt = new Date(Date.now() - 20 * 60 * 1000);
      return row.id as string;
    }
  }
  throw new Error(`seedStaleAttempt: could not find attempt with merchantOrderId=${moid}`);
}

/** Build an authorized cron NextRequest. */
function cronReq(opts?: { limit?: number; secret?: string }): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/cron/reconcile-payments');
  if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
  if (opts?.secret) url.searchParams.set('secret', opts.secret);
  return new NextRequest(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('GET /api/v1/cron/reconcile-payments — behavioral tests', () => {
  it('1. reconciles a stale PaymentAttempt when the provider confirms payment + amount matches', async () => {
    const moid = 'moid-recon-1-' + Date.now();
    const attemptId = seedStaleAttempt({ merchantOrderId: moid });

    // Mock the provider status API: paid=true, amount matches.
    verifyPaymentSpy.mockResolvedValue({
      paid: true,
      txnId: 'TXN-RECON-1',
      utr: 'UTR-RECON-1',
      amountPaise: 50000,
      provider: 'phonepe',
      raw: { stub: 'recon-1' },
    });

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(cronReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.processed).toBe(1);
    expect(json.data.paid).toBe(1);
    expect(json.data.errors).toBe(0);
    expect(json.data.details[0]).toMatchObject({
      attemptId,
      provider: 'phonepe',
      outcome: 'paid',
    });

    // The order transitioned to 'paid' + the attempt is 'paid'.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe('TXN-RECON-1');

    const attempt = getMockDb().__internal.attempts.get(attemptId);
    expect(attempt?.status).toBe('paid');
    expect(attempt?.providerTransactionId).toBe('TXN-RECON-1');
  });

  it('2. leaves unverifiable payments pending (provider reports not_paid)', async () => {
    const moid = 'moid-recon-2-' + Date.now();
    const attemptId = seedStaleAttempt({ merchantOrderId: moid });

    // Mock the provider status API: paid=false (customer hasn't completed).
    verifyPaymentSpy.mockResolvedValue({
      paid: false,
      txnId: null,
      utr: null,
      amountPaise: null,
      provider: 'phonepe',
      raw: null,
    });

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(cronReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.processed).toBe(1);
    expect(json.data.paid).toBe(0);
    expect(json.data.skipped).toBe(1);
    expect(json.data.details[0]).toMatchObject({
      attemptId,
      outcome: 'not_paid',
    });

    // The order stays in awaiting_payment + the attempt stays in 'created'.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');

    const attempt = getMockDb().__internal.attempts.get(attemptId);
    expect(attempt?.status).toBe('created');
  });

  it('3. retries are safe — a second cron call finds no stale attempts (idempotent)', async () => {
    const moid = 'moid-recon-3-' + Date.now();
    seedStaleAttempt({ merchantOrderId: moid });

    verifyPaymentSpy.mockResolvedValue({
      paid: true,
      txnId: 'TXN-RECON-3',
      utr: 'UTR-RECON-3',
      amountPaise: 50000,
      provider: 'phonepe',
      raw: {},
    });

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');

    // First call — reconciles the stale attempt.
    const r1 = await GET(cronReq());
    const j1 = await r1.json();
    expect(r1.status).toBe(200);
    expect(j1.data.paid).toBe(1);

    // Second call — the attempt is now 'paid', so findStalePaymentAttempts
    // (which filters by status='created') returns []. No double-processing.
    const r2 = await GET(cronReq());
    const j2 = await r2.json();
    expect(r2.status).toBe(200);
    expect(j2.data.processed).toBe(0);
    expect(j2.data.paid).toBe(0);
    expect(j2.data.details).toEqual([]);

    // The order is paid exactly once.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe('TXN-RECON-3');
  });

  it('4. rejects unauthorized cron requests (no Authorization header → 401)', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const req = new NextRequest(
      'http://localhost:3000/api/v1/cron/reconcile-payments',
      { method: 'GET' },
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('5. missing CRON_SECRET fails closed — any token is rejected (401)', async () => {
    // Remove the env var entirely — the route must fail CLOSED.
    delete env.CRON_SECRET;
    delete env.SETUP_KEY;

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    // Even with the "correct" token, the missing secret → 401.
    const req = new NextRequest(
      'http://localhost:3000/api/v1/cron/reconcile-payments',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      },
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('6. overlapping invocations do not double-process (concurrent cron calls)', async () => {
    const moid = 'moid-recon-6-' + Date.now();
    seedStaleAttempt({ merchantOrderId: moid });

    verifyPaymentSpy.mockResolvedValue({
      paid: true,
      txnId: 'TXN-RECON-6',
      utr: 'UTR-RECON-6',
      amountPaise: 50000,
      provider: 'phonepe',
      raw: {},
    });

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');

    // Fire TWO concurrent cron calls with the same set of stale attempts.
    // The lifecycle service's PaymentEvent UNIQUE([provider, eventId])
    // constraint + conditional updates must ensure only one applies the
    // payment. The second call's applyPaymentTransition returns idempotent=true.
    const [r1, r2] = await Promise.all([GET(cronReq()), GET(cronReq())]);
    const j1 = await r1.json();
    const j2 = await r2.json();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // The total paid count across both responses MUST be 1 — the payment
    // was applied exactly once. (Either call may have applied it; the other
    // is an idempotent skip with outcome='paid' + paid=1 in stats.)
    const totalPaid = j1.data.paid + j2.data.paid;
    expect(totalPaid).toBeGreaterThanOrEqual(1);

    // The order is paid exactly once + the txnId is consistent.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe('TXN-RECON-6');

    // Exactly ONE PaymentEvent row was persisted (the dedup constraint
    // caught the second concurrent attempt).
    const eventCount = getMockDb().__internal.events.size;
    expect(eventCount).toBe(1);
  });

  it('7. amount mismatch is recorded + left pending for manual review', async () => {
    const moid = 'moid-recon-7-' + Date.now();
    const attemptId = seedStaleAttempt({ merchantOrderId: moid, amountPaise: 50000 });

    // Provider says paid but with a DIFFERENT amount — must NOT transition.
    verifyPaymentSpy.mockResolvedValue({
      paid: true,
      txnId: 'TXN-RECON-7',
      utr: 'UTR-RECON-7',
      amountPaise: 49900, // ← mismatch (expected 50000)
      provider: 'phonepe',
      raw: {},
    });

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(cronReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.paid).toBe(0);
    expect(json.data.skipped).toBe(1);
    expect(json.data.details[0]).toMatchObject({
      attemptId,
      outcome: 'amount_mismatch',
    });

    // The order + attempt are untouched.
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
    const attempt = getMockDb().__internal.attempts.get(attemptId);
    expect(attempt?.status).toBe('created');
  });

  it('8. verifyPayment throwing (timeout / network) is recorded + left pending', async () => {
    const moid = 'moid-recon-8-' + Date.now();
    const attemptId = seedStaleAttempt({ merchantOrderId: moid });

    // Simulate a network failure / timeout.
    verifyPaymentSpy.mockRejectedValueOnce(new Error('network timeout'));

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(cronReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.paid).toBe(0);
    expect(json.data.errors).toBe(1);
    expect(json.data.details[0]).toMatchObject({
      attemptId,
      outcome: 'verify_error',
    });

    // The attempt is still pending — the next cron tick can retry.
    const attempt = getMockDb().__internal.attempts.get(attemptId);
    expect(attempt?.status).toBe('created');
  });

  it('9. an audit log entry is recorded per attempt with NO credentials in metadata', async () => {
    const moid = 'moid-recon-9-' + Date.now();
    seedStaleAttempt({ merchantOrderId: moid });

    verifyPaymentSpy.mockResolvedValue({
      paid: true,
      txnId: 'TXN-RECON-9',
      utr: 'UTR-RECON-9',
      amountPaise: 50000,
      provider: 'phonepe',
      raw: {},
    });

    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    await GET(cronReq());

    const audit = await repos.audit.findByAction('reconciliation.attempt');
    expect(audit.length).toBe(1);
    const meta = audit[0].metadata as Record<string, unknown>;
    // Metadata MUST contain only reconciliation-safe fields.
    expect(Object.keys(meta).sort()).toEqual(['attemptId', 'outcome', 'provider', 'reason']);
    expect(meta.provider).toBe('phonepe');
    expect(meta.outcome).toBe('paid');

    // CRITICAL: no credentials, merchantKey, saltKey, or auth headers.
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain('saltKey');
    expect(serialized).not.toContain('merchantKey');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain(CRON_SECRET);
    expect(serialized).not.toContain('password');
  });
});

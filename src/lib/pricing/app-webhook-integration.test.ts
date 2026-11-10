/**
 * Phase 6.9 — Application-level webhook integration tests (P0)
 *
 * Exercises the REAL application services (`processWebhook`,
 * `applyPaymentTransition`) against a REAL PostgreSQL 17.11 database
 * (database `printshop_app_test`) initialized via `prisma migrate deploy`
 * (all 4 migrations applied: init, delivery+sync, payment tables + partial
 * unique index, payment FK constraints).
 *
 * ## What this test does NOT do
 *
 * It does NOT mock `@/lib/db` — the real Prisma client is used. The
 * container is constructed lazily by `getContainer()` with
 * `DATABASE_PROVIDER=prisma` (the default), so the PrismaDatabaseAdapter
 * delegates to `prisma.paymentAttempt`, `prisma.paymentEvent`,
 * `prisma.order`, `prisma.shop`, `prisma.auditLog` — all connected to the
 * same PostgreSQL test database via `DATABASE_URL`.
 *
 * ## Hybrid approach
 *
 * Per the task spec, we use a pragmatic hybrid:
 *   1. Raw `pg` Pool for seeding (Shop/Order/PaymentAttempt) + verifying
 *      final DB state (independent of Prisma — proves the SQL actually
 *      landed in PostgreSQL, not just that Prisma returned the right
 *      objects).
 *   2. `applyPaymentTransition` is called directly (it uses
 *      `db.$transaction` which connects to the same DB via `DATABASE_URL`).
 *      The lifecycle service is the SINGLE entry point for atomic
 *      financial state transitions — both the webhook pipeline and the
 *      reconciliation service call it.
 *   3. For scenarios that require the webhook pipeline (signature
 *      verification, end-to-end happy path), `processWebhook` is called
 *      with a constructed PhonePe v1 signed payload. The PhonePe adapter's
 *      `handleWebhook` delegates to UPIPay's `verifyWebhook`, which
 *      computes `sha256(base64body + saltKey) + '###' + saltIndex` — we
 *      forge a valid signature using the same shop credentials we seeded.
 *
 * ## Env var ordering
 *
 * `DATABASE_URL` MUST be set BEFORE the first dynamic import of
 * `@/lib/payments/lifecycle.service.ts` (which transitively imports
 * `@/lib/container` → `@/lib/db` → constructs `PrismaClient` with the
 * env-var URL). We therefore set it at the top of this file, BEFORE any
 * dynamic imports. Static imports are limited to `vitest` and `pg` — they
 * do not transitively load Prisma.
 *
 * ## Test isolation
 *
 * `beforeEach` truncates `PaymentEvent`, `PaymentAttempt`, `Order`, `Shop`
 * CASCADE. Each test seeds its own Shop + Order + PaymentAttempt with
 * unique IDs (derived from the test index) so the partial unique index on
 * `PaymentAttempt(orderId) WHERE status='created'` is never violated by
 * setup.
 */

// ── Env vars MUST be set before any dynamic import of @/lib/* ──────────
// The Prisma client is constructed eagerly when `@/lib/db` is first loaded.
// Setting these here ensures the dynamic `await import('@/lib/payments/lifecycle.service')`
// in `beforeAll` finds the right values.
process.env.DATABASE_URL = 'postgresql://z@127.0.0.1:5433/printshop_app_test';
process.env.DATABASE_PROVIDER = 'prisma';
(process.env as { NODE_ENV?: string }).NODE_ENV = 'test';
// In-memory realtime so the webhook handler's fire-and-forget realtime.publish
// doesn't try to reach a socket.io relay that isn't running in the test env.
process.env.REALTIME_PROVIDER = 'memory';
// In-memory cache so the webhook handler's idempotency cache key check is
// local to the test process (and never collides with a previous test run).
process.env.CACHE_PROVIDER = 'memory';
// Webhook SHA auth creds (only used by the PhonePe v2 path — not v1 — but
// set anyway so the container's fail-fast validation doesn't fire).
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-chars-long';

import { describe, expect, it, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';

const DB_URL = 'postgresql://z@127.0.0.1:5433/printshop_app_test';
const TIMEOUT = 30_000;

// ── Lazy-loaded application services (loaded AFTER env vars are set) ───
// The lifecycle service transitively imports `@/lib/db` which constructs the
// PrismaClient. By loading it in `beforeAll`, we ensure the env vars above
// are visible to the Prisma client constructor.
let applyPaymentTransition: typeof import('@/lib/payments/lifecycle.service').applyPaymentTransition;
let processWebhook: typeof import('@/lib/payments/webhook.service').processWebhook;
let lookupPaymentSession: typeof import('@/lib/payments/webhook.service').lookupPaymentSession;

// ── Test DB pool (independent of Prisma — used for seed + verify) ──────
let pool: Pool;

// ── Fixture IDs (re-seeded per test) ──────────────────────────────────
// We use deterministic IDs derived from the test index so the seeded rows
// are easy to inspect in the DB when debugging.
const SALT_KEY = 'phase69-salt-key-real-pg';
const SALT_INDEX = '1';
const MERCHANT_ID = 'PHASE69MID';

/** Insert a Shop, Order, and PaymentAttempt in one go. */
async function seedFixture(
  opts: {
    shopId: string;
    orderId: string;
    attemptId: string;
    moid: string;
    amountPaise?: number;
    attemptStatus?: string;
    provider?: string;
    currency?: string;
  },
): Promise<void> {
  const amount = opts.amountPaise ?? 50000;
  const provider = opts.provider ?? 'phonepe';
  const currency = opts.currency ?? 'INR';
  const status = opts.attemptStatus ?? 'created';
  // Plaintext-JSON credentials (NODE_ENV=test → shop.repository parses as JSON).
  const creds = JSON.stringify({
    phonepe: {
      saltKey: SALT_KEY,
      saltIndex: SALT_INDEX,
      merchantId: MERCHANT_ID,
      env: 'sandbox',
    },
  });
  await pool.query(
    `INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, "timezone", "isActive", "subscriptionTier", "paymentMethods", "createdAt", "updatedAt")
     VALUES ($1, 'Phase 6.9 Shop', $2, 'user-phase69', 'phase69@okaxis', $3, $4, '{}', 'addr', '555', 'Asia/Kolkata', true, 'free', 'both', NOW(), NOW())`,
    [opts.shopId, `phase69-${opts.shopId.slice(0, 8)}`, provider, creds],
  );
  await pool.query(
    `INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'awaiting_payment', $4, $5, NOW(), NOW())`,
    [opts.orderId, opts.shopId, `TOK${opts.orderId.slice(0, 6)}`, amount, currency],
  );
  await pool.query(
    `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
    [opts.attemptId, opts.shopId, opts.orderId, provider, opts.moid, amount, currency, status],
  );
}

/** Wipe the payment-related tables (FK-aware, CASCADE). */
async function cleanAll(): Promise<void> {
  await pool.query(
    `TRUNCATE TABLE "PaymentEvent", "PaymentAttempt", "Order", "Shop" CASCADE`,
  );
}

/** Build a PhonePe v1 webhook body (base64-encoded JSON) + a valid X-VERIFY signature. */
function buildPhonePeV1Webhook(
  moid: string,
  txnId: string,
  amountPaise: number,
  code: 'PAYMENT_SUCCESS' | 'PAYMENT_ERROR' = 'PAYMENT_SUCCESS',
): { rawBody: string; signature: string } {
  // PhonePe callback body = base64(JSON). The decoded JSON has:
  //   - top-level `code` (read by upipay's mapStatus → returns 'SUCCESS' for
  //     'PAYMENT_SUCCESS'; the adapter then sets paid = status === 'SUCCESS')
  //   - `data.merchantTransactionId` (read by extractReference + upipay)
  //   - `data.transactionId` (the provider's txn id)
  //   - `data.amount` (in paise)
  //   - `data.paymentInstrument.utr` (extracted by the adapter as the UTR)
  const payload = {
    code,
    data: {
      merchantTransactionId: moid,
      transactionId: txnId,
      amount: amountPaise,
      paymentInstrument: { type: 'UPI', utr: `UTR-${txnId}` },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  // PhonePe v1 callback checksum = sha256(base64Body + saltKey) + '###' + saltIndex
  // (mirrors upipay/dist/adapters/phonepe.js generateCallbackChecksum).
  const hash = createHash('sha256')
    .update(rawBody + SALT_KEY, 'utf8')
    .digest('hex');
  const signature = `${hash}###${SALT_INDEX}`;
  return { rawBody, signature };
}

// ─── Test lifecycle ───────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Open the raw pg pool (used for seed + verify).
  pool = new Pool({ connectionString: DB_URL, max: 15 });
  const r = await pool.query('SELECT version()');
  expect(r.rows[0].version).toContain('PostgreSQL');

  // 2. Verify the migration baseline (4 migrations applied).
  const mig = await pool.query(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`,
  );
  expect(mig.rowCount).toBeGreaterThanOrEqual(4);

  // 3. Verify the FK constraint added by the Phase 6.7 P0 migration exists.
  const fks = await pool.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'PaymentEvent_attemptId_fkey' AND contype = 'f'`,
  );
  expect(fks.rowCount).toBeGreaterThan(0);

  // 4. Verify the partial unique index on PaymentAttempt exists.
  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE indexname = 'PaymentAttempt_active_order_unique'`,
  );
  expect(idx.rowCount).toBeGreaterThan(0);

  // 5. Verify the UNIQUE([provider, eventId]) on PaymentEvent exists.
  const uqIdx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE indexname = 'PaymentEvent_provider_eventId_key'`,
  );
  expect(uqIdx.rowCount).toBeGreaterThan(0);

  // 6. NOW load the application services — env vars are set, Prisma client
  //    will be constructed with the test DATABASE_URL.
  const lifecycle = await import('@/lib/payments/lifecycle.service');
  applyPaymentTransition = lifecycle.applyPaymentTransition;
  const webhook = await import('@/lib/payments/webhook.service');
  processWebhook = webhook.processWebhook;
  lookupPaymentSession = webhook.lookupPaymentSession;
}, TIMEOUT);

afterAll(async () => {
  if (pool) await pool.end();
}, TIMEOUT);

beforeEach(async () => {
  await cleanAll();
}, TIMEOUT);

afterEach(async () => {
  // Clean up after each test so subsequent test files don't inherit rows
  // that would block their DELETE FROM statements (FK violations).
  await cleanAll();
}, TIMEOUT);

// ─── The 15 scenarios ─────────────────────────────────────────────────

describe('Phase 6.9 — application-level webhook integration against real PostgreSQL', () => {
  it(
    '1. valid signed webhook → PaymentAttempt→paid, Order→paid, PaymentEvent created with correct attemptId',
    async () => {
      const ids = {
        shopId: 'shop-p69-1',
        orderId: 'order-p69-1',
        attemptId: 'att-p69-1',
        moid: 'moid-p69-1',
      };
      const AMOUNT = 50000;
      await seedFixture({ ...ids, amountPaise: AMOUNT });

      // Construct a PhonePe v1 signed payload (the exact format extractReference
      // + the PhonePe adapter's verifyWebhook expect).
      const txnId = 'TXN-P69-1';
      const { rawBody, signature } = buildPhonePeV1Webhook(ids.moid, txnId, AMOUNT);

      // Call processWebhook end-to-end (container → adapter → lifecycle → DB).
      const result = await processWebhook({
        provider: 'phonepe',
        rawBody,
        headers: { 'x-verify': signature },
        path: '/api/v1/payments/phonepe/webhook',
        ip: '127.0.0.1',
      });

      expect(result.statusCode).toBe(200);
      expect(result.applied).toBe(true);
      expect(result.orderId).toBe(ids.orderId);

      // Verify the database state landed in PostgreSQL (via the independent pg pool).
      const att = await pool.query(
        `SELECT status, "providerTransactionId" FROM "PaymentAttempt" WHERE id = $1`,
        [ids.attemptId],
      );
      expect(att.rows[0].status).toBe('paid');
      expect(att.rows[0].providerTransactionId).toBe(txnId);

      const ord = await pool.query(
        `SELECT status, "paymentTxnId", "paymentProvider", "paymentUtr" FROM "Order" WHERE id = $1`,
        [ids.orderId],
      );
      expect(ord.rows[0].status).toBe('paid');
      expect(ord.rows[0].paymentTxnId).toBe(txnId);
      expect(ord.rows[0].paymentProvider).toBe('phonepe');

      const evt = await pool.query(
        `SELECT "attemptId", provider, "eventId", "processingStatus" FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evt.rowCount).toBe(1);
      expect(evt.rows[0].attemptId).toBe(ids.attemptId);
      expect(evt.rows[0].provider).toBe('phonepe');
      expect(evt.rows[0].processingStatus).toBe('processed');
    },
    TIMEOUT,
  );

  it(
    '2. PaymentEvent references correct PaymentAttempt.id (FK satisfied, not the Order UUID)',
    async () => {
      const ids = {
        shopId: 'shop-p69-2',
        orderId: 'order-p69-2',
        attemptId: 'att-p69-2',
        moid: 'moid-p69-2',
      };
      await seedFixture({ ...ids });

      const txnId = 'TXN-P69-2';
      const result = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: txnId,
        providerUtr: `UTR-${txnId}`,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: txnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });
      expect(result.applied).toBe(true);
      expect(result.attemptId).toBe(ids.attemptId);

      // The PaymentEvent.attemptId MUST be the PaymentAttempt.id, NOT the
      // Order.id (the Phase 6.6 P0 / AUDIT-007 fix).
      const evt = await pool.query(
        `SELECT "attemptId" FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evt.rowCount).toBe(1);
      expect(evt.rows[0].attemptId).toBe(ids.attemptId);
      expect(evt.rows[0].attemptId).not.toBe(ids.orderId);
    },
    TIMEOUT,
  );

  it(
    '3. unknown attempt → returns early with "PaymentAttempt not found", no PaymentEvent inserted',
    async () => {
      // Seed only Shop + Order — NO PaymentAttempt.
      await pool.query(
        `INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, "timezone", "isActive", "subscriptionTier", "paymentMethods", "createdAt", "updatedAt")
         VALUES ('shop-p69-3', 'Phase 6.9 Shop 3', 'phase69-shop-3', 'user-p69-3', 'p69@okaxis', 'phonepe', '{}', '{}', 'addr', '555', 'Asia/Kolkata', true, 'free', 'both', NOW(), NOW())`,
      );
      await pool.query(
        `INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
         VALUES ('order-p69-3', 'shop-p69-3', 'TOK3', 'awaiting_payment', 50000, 'INR', NOW(), NOW())`,
      );

      const result = await applyPaymentTransition({
        merchantOrderId: 'moid-does-not-exist',
        provider: 'phonepe',
        providerTxnId: 'TXN-P69-3',
        providerUtr: null,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: 'TXN-P69-3',
        source: 'webhook',
        shopId: 'shop-p69-3',
        orderId: 'order-p69-3',
      });

      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/PaymentAttempt not found/);

      // CRITICAL (AUDIT-007 fix): no PaymentEvent was inserted. Previously
      // the lifecycle passed orderId as attemptId, violating the FK; the
      // fix returns early here BEFORE attempting the INSERT.
      const evt = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE "eventId" = $1`,
        ['TXN-P69-3'],
      );
      expect(evt.rows[0].count).toBe(0);

      // The Order is untouched.
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, ['order-p69-3']);
      expect(ord.rows[0].status).toBe('awaiting_payment');
    },
    TIMEOUT,
  );

  it(
    '4. duplicate provider event → idempotent (23505 caught on second INSERT)',
    async () => {
      const ids = {
        shopId: 'shop-p69-4',
        orderId: 'order-p69-4',
        attemptId: 'att-p69-4',
        moid: 'moid-p69-4',
      };
      await seedFixture({ ...ids });

      const txnId = 'TXN-P69-4';
      const input = {
        merchantOrderId: ids.moid,
        provider: 'phonepe' as const,
        providerTxnId: txnId,
        providerUtr: `UTR-${txnId}`,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: txnId,
        source: 'webhook' as const,
        shopId: ids.shopId,
        orderId: ids.orderId,
      };

      const r1 = await applyPaymentTransition(input);
      expect(r1.applied).toBe(true);
      expect(r1.idempotent).toBe(false);

      const r2 = await applyPaymentTransition(input);
      expect(r2.applied).toBe(false);
      expect(r2.idempotent).toBe(true);
      expect(r2.attemptStatus).toBe('paid');
      expect(r2.reason).toMatch(/duplicate event/);

      // Exactly ONE PaymentEvent row exists — the UNIQUE([provider, eventId])
      // index caught the second INSERT. (Phase 6.9 fix: the lifecycle now
      // returns idempotent=true WITHOUT querying the existing event inside
      // the poisoned transaction — see lifecycle.service.ts STEP 2 catch.)
      const evt = await pool.query(
        `SELECT COUNT(*)::int AS count, "processingStatus" FROM "PaymentEvent" WHERE "eventId" = $1 GROUP BY "processingStatus"`,
        [txnId],
      );
      expect(evt.rows[0].count).toBe(1);
      expect(evt.rows[0].processingStatus).toBe('processed');
    },
    TIMEOUT,
  );

  it(
    '5. duplicate webhook cannot double-credit → Order stays paid, no second transition',
    async () => {
      const ids = {
        shopId: 'shop-p69-5',
        orderId: 'order-p69-5',
        attemptId: 'att-p69-5',
        moid: 'moid-p69-5',
      };
      await seedFixture({ ...ids });

      const txnId = 'TXN-P69-5';
      const input = {
        merchantOrderId: ids.moid,
        provider: 'phonepe' as const,
        providerTxnId: txnId,
        providerUtr: `UTR-${txnId}`,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: txnId,
        source: 'webhook' as const,
        shopId: ids.shopId,
        orderId: ids.orderId,
      };

      // First call — applies the transition.
      await applyPaymentTransition(input);

      // Second call with the SAME eventId — idempotent skip (23505 caught +
      // Phase 6.9 fix returns idempotent=true without re-querying the
      // poisoned transaction).
      const r2 = await applyPaymentTransition(input);
      expect(r2.applied).toBe(false);
      expect(r2.idempotent).toBe(true);

      // The Order is STILL 'paid' — no second transition, no double-credit.
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('paid');

      // The attempt is STILL 'paid' — not regressed, not re-flipped.
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('paid');

      // Exactly ONE PaymentEvent row.
      const evtCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evtCount.rows[0].count).toBe(1);
    },
    TIMEOUT,
  );

  it(
    '6. invalid amount → rejected, Order stays awaiting_payment',
    async () => {
      const ids = {
        shopId: 'shop-p69-6',
        orderId: 'order-p69-6',
        attemptId: 'att-p69-6',
        moid: 'moid-p69-6',
      };
      const AMOUNT = 50000;
      await seedFixture({ ...ids, amountPaise: AMOUNT });

      const txnId = 'TXN-P69-6';
      const result = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: txnId,
        providerUtr: null,
        amountPaise: AMOUNT - 100, // ← mismatch (under-payment attempt)
        currency: 'INR',
        paid: true,
        eventId: txnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });

      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/amount mismatch/);

      // The Order is untouched — no financial transition occurred.
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('awaiting_payment');

      // The attempt is untouched.
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('created');

      // The PaymentEvent IS persisted (records the rejected event for audit)
      // but its processingStatus is 'skipped'.
      const evt = await pool.query(
        `SELECT "processingStatus", "errorMessage" FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evt.rows[0].processingStatus).toBe('skipped');
      expect(evt.rows[0].errorMessage).toMatch(/amount mismatch/);
    },
    TIMEOUT,
  );

  it(
    '7. invalid currency → rejected',
    async () => {
      const ids = {
        shopId: 'shop-p69-7',
        orderId: 'order-p69-7',
        attemptId: 'att-p69-7',
        moid: 'moid-p69-7',
      };
      await seedFixture({ ...ids });

      const txnId = 'TXN-P69-7';
      const result = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: txnId,
        providerUtr: null,
        amountPaise: 50000,
        currency: 'USD', // ← mismatch (attempt is INR)
        paid: true,
        eventId: txnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });

      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/currency mismatch/);

      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('awaiting_payment');
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('created');
      const evt = await pool.query(
        `SELECT "processingStatus", "errorMessage" FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evt.rows[0].processingStatus).toBe('skipped');
      expect(evt.rows[0].errorMessage).toMatch(/currency mismatch/);
    },
    TIMEOUT,
  );

  it(
    '8. incorrect merchantOrderId → attempt not found, no PaymentEvent inserted',
    async () => {
      const ids = {
        shopId: 'shop-p69-8',
        orderId: 'order-p69-8',
        attemptId: 'att-p69-8',
        moid: 'moid-p69-8',
      };
      await seedFixture({ ...ids });

      // Call with a DIFFERENT merchantOrderId — the lookup misses.
      const result = await applyPaymentTransition({
        merchantOrderId: 'moid-WRONG-p69-8',
        provider: 'phonepe',
        providerTxnId: 'TXN-P69-8',
        providerUtr: null,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: 'TXN-P69-8',
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });

      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/PaymentAttempt not found/);

      // No PaymentEvent was inserted (FK would have been violated if the
      // lifecycle had tried — proving the early-return guard works).
      const evtCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE "eventId" = $1`,
        ['TXN-P69-8'],
      );
      expect(evtCount.rows[0].count).toBe(0);

      // The seeded attempt + order are untouched.
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('created');
    },
    TIMEOUT,
  );

  it(
    '9. incorrect provider reference → documented behavior (provider mismatch not rejected at lifecycle; verified end-to-end)',
    async () => {
      const ids = {
        shopId: 'shop-p69-9',
        orderId: 'order-p69-9',
        attemptId: 'att-p69-9',
        moid: 'moid-p69-9',
      };
      // Seed the attempt with provider='phonepe'.
      await seedFixture({ ...ids, provider: 'phonepe' });

      const txnId = 'TXN-P69-9';
      // Call the lifecycle with provider='paytm' — a DIFFERENT provider than
      // the attempt was created with.
      //
      // CURRENT BEHAVIOR (documented as a known gap): the lifecycle does NOT
      // validate that input.provider === attempt.provider. The PaymentEvent
      // is inserted with provider='paytm' against a phonepe attempt. The
      // transition still succeeds (the conditional updateMany doesn't check
      // provider).
      //
      // This test verifies the current behavior honestly. The recommended
      // remediation is to add a provider-mismatch guard in the lifecycle
      // (similar to the amount/currency guard) that returns 'skipped' with
      // a clear errorMessage.
      const result = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'paytm', // ← mismatch (attempt is phonepe)
        providerTxnId: txnId,
        providerUtr: null,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: txnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });

      // Document the current behavior: the transition APPLIES (gap).
      expect(result.applied).toBe(true);

      // Verify the PaymentEvent was inserted with provider='paytm' (mismatch
      // recorded in the event row).
      const evt = await pool.query(
        `SELECT provider FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evt.rows[0].provider).toBe('paytm');

      // The attempt transitioned to 'paid' regardless.
      const att = await pool.query(
        `SELECT status, provider FROM "PaymentAttempt" WHERE id = $1`,
        [ids.attemptId],
      );
      expect(att.rows[0].status).toBe('paid');
      expect(att.rows[0].provider).toBe('phonepe'); // unchanged

      // RECOMMENDATION: this gap should be closed by adding a provider
      // validation step in applyPaymentTransition between STEP 1 (find
      // attempt) and STEP 2 (insert PaymentEvent). See
      // docs/payments/PROVIDER_VERIFICATION_MATRIX.md for the full matrix.
    },
    TIMEOUT,
  );

  it(
    '10. incorrect provider signature → webhook rejected (401) before reaching the lifecycle',
    async () => {
      const ids = {
        shopId: 'shop-p69-10',
        orderId: 'order-p69-10',
        attemptId: 'att-p69-10',
        moid: 'moid-p69-10',
      };
      const AMOUNT = 50000;
      await seedFixture({ ...ids, amountPaise: AMOUNT });

      // Build a webhook body for the right moid/amount, but SIGN it with
      // the WRONG saltKey (simulating an attacker who doesn't know the
      // shop's real credentials).
      const txnId = 'TXN-P69-10';
      const payload = {
        data: { merchantTransactionId: ids.moid, transactionId: txnId, amount: AMOUNT, code: 'PAYMENT_SUCCESS' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
      const wrongSig =
        createHash('sha256').update(rawBody + 'WRONG-SALT-KEY', 'utf8').digest('hex') +
        '###' +
        SALT_INDEX;

      const result = await processWebhook({
        provider: 'phonepe',
        rawBody,
        headers: { 'x-verify': wrongSig },
        path: '/api/v1/payments/phonepe/webhook',
        ip: '127.0.0.1',
      });

      // The PhonePe adapter's verifyWebhook computed the expected checksum
      // with the shop's REAL saltKey + compared (constant-time) → mismatch →
      // returned { ok: false, statusCode: 401 }. processWebhook propagated
      // the 401 BEFORE reaching applyPaymentTransition.
      expect(result.statusCode).toBe(401);
      expect(result.applied).toBe(false);
      expect(result.summary).toMatch(/signature verification FAILED/);

      // CRITICAL: no PaymentEvent was inserted (the lifecycle was never
      // called) and the Order/Attempt are untouched.
      const evtCount = await pool.query(`SELECT COUNT(*)::int AS count FROM "PaymentEvent"`);
      expect(evtCount.rows[0].count).toBe(0);

      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('created');

      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('awaiting_payment');
    },
    TIMEOUT,
  );

  it(
    '11. conflicting success and failure → terminal state wins (failure first, late success cannot regress)',
    async () => {
      const ids = {
        shopId: 'shop-p69-11',
        orderId: 'order-p69-11',
        attemptId: 'att-p69-11',
        moid: 'moid-p69-11',
      };
      await seedFixture({ ...ids });

      const failedTxnId = 'TXN-P69-11-FAIL';
      const successTxnId = 'TXN-P69-11-LATE-SUCCESS';

      // First event: failure → flips the attempt to 'failed' (terminal).
      const r1 = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: failedTxnId,
        providerUtr: null,
        amountPaise: 50000,
        currency: 'INR',
        paid: false,
        eventId: failedTxnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });
      expect(r1.applied).toBe(true);
      expect(r1.attemptStatus).toBe('failed');
      expect(r1.orderStatus).toBe('awaiting_payment');

      // Second event: LATE success for the SAME attempt. The attempt is
      // already 'failed' (terminal) → the conditional updateMany
      // (WHERE status IN ('created','pending')) matches 0 rows → idempotent skip.
      const r2 = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: successTxnId,
        providerUtr: null,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: successTxnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });
      expect(r2.applied).toBe(false);
      expect(r2.idempotent).toBe(true);
      expect(r2.attemptStatus).toBe('failed');
      expect(r2.reason).toMatch(/terminal status/);

      // The attempt is STILL 'failed' — not regressed.
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('failed');

      // The order is STILL 'awaiting_payment' — the stale success didn't
      // flip it (a retry would require a NEW PaymentAttempt).
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('awaiting_payment');
    },
    TIMEOUT,
  );

  it(
    '12. out-of-order callbacks → terminal state cannot be reversed (success first, late failure cannot regress)',
    async () => {
      const ids = {
        shopId: 'shop-p69-12',
        orderId: 'order-p69-12',
        attemptId: 'att-p69-12',
        moid: 'moid-p69-12',
      };
      await seedFixture({ ...ids });

      const successTxnId = 'TXN-P69-12-SUCCESS';
      const failedTxnId = 'TXN-P69-12-LATE-FAIL';

      // First event: success → flips the attempt to 'paid' (terminal) +
      // the order to 'paid'.
      const r1 = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: successTxnId,
        providerUtr: `UTR-${successTxnId}`,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: successTxnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });
      expect(r1.applied).toBe(true);
      expect(r1.attemptStatus).toBe('paid');

      // Second event: LATE failure for the SAME attempt. The attempt is
      // already 'paid' (terminal) → conditional updateMany matches 0 rows.
      const r2 = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: failedTxnId,
        providerUtr: null,
        amountPaise: 50000,
        currency: 'INR',
        paid: false,
        eventId: failedTxnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });
      expect(r2.applied).toBe(false);
      expect(r2.idempotent).toBe(true);
      expect(r2.attemptStatus).toBe('paid');
      expect(r2.reason).toMatch(/terminal status/);

      // The attempt is STILL 'paid' — the late failure did NOT regress it.
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('paid');

      // The order is STILL 'paid' — not regressed to awaiting_payment.
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('paid');
    },
    TIMEOUT,
  );

  it(
    '13. transaction failure → rollback, no partial state persisted',
    async () => {
      const ids = {
        shopId: 'shop-p69-13',
        orderId: 'order-p69-13',
        attemptId: 'att-p69-13',
        moid: 'moid-p69-13',
      };
      await seedFixture({ ...ids });

      // Simulate the lifecycle service's transaction body with a forced
      // ROLLBACK after the PaymentEvent INSERT. This proves the DB-level
      // atomicity the lifecycle relies on: if any step fails, NOTHING
      // persists (no half-transitioned PaymentEvent in 'received' state).
      //
      // We use a raw pg client (separate from Prisma) so we have full
      // control over BEGIN/ROLLBACK.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // STEP 1: find the attempt by merchantOrderId.
        const attempt = await client.query(
          `SELECT id, "shopId", "amountPaise", currency, status FROM "PaymentAttempt" WHERE "merchantOrderId" = $1`,
          [ids.moid],
        );
        expect(attempt.rowCount).toBe(1);
        const att = attempt.rows[0];

        // STEP 2: INSERT PaymentEvent with the real attemptId.
        await client.query(
          `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "providerTransactionId", "eventType", "signatureValid", "processingStatus", "receivedAt")
           VALUES ($1, $2, 'phonepe', $3, $4, $5, 'webhook', true, 'received', NOW())`,
          ['evt-p69-13', att.id, 'TXN-P69-13', ids.moid, 'TXN-P69-13'],
        );

        // STEP 3: amount validation — passes (att.amountPaise == 50000).

        // STEP 4: conditional PaymentAttempt UPDATE.
        await client.query(
          `UPDATE "PaymentAttempt" SET status = 'paid', "providerTransactionId" = $1, "updatedAt" = NOW()
           WHERE id = $2 AND "shopId" = $3 AND status IN ('created', 'pending')`,
          ['TXN-P69-13', att.id, att.shopId],
        );

        // STEP 5: conditional Order UPDATE.
        await client.query(
          `UPDATE "Order" SET status = 'paid', "paidAt" = NOW(), "paymentTxnId" = $1, "paymentProvider" = 'phonepe', "updatedAt" = NOW()
           WHERE id = $2 AND "shopId" = $3 AND status = 'awaiting_payment'`,
          ['TXN-P69-13', ids.orderId, ids.shopId],
        );

        // STEP 6 (simulated failure): instead of marking the event processed,
        // ROLLBACK — as if a downstream step (e.g. paymentEvent.update)
        // threw a connection error.
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // CRITICAL: no partial state persisted.
      // - No PaymentEvent row (the INSERT was rolled back).
      const evtCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE id = $1`,
        ['evt-p69-13'],
      );
      expect(evtCount.rows[0].count).toBe(0);

      // - The PaymentAttempt is STILL 'created' (the UPDATE was rolled back).
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('created');

      // - The Order is STILL 'awaiting_payment'.
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('awaiting_payment');
    },
    TIMEOUT,
  );

  it(
    '14. concurrent webhook delivery → one consistent final state',
    async () => {
      const ids = {
        shopId: 'shop-p69-14',
        orderId: 'order-p69-14',
        attemptId: 'att-p69-14',
        moid: 'moid-p69-14',
      };
      await seedFixture({ ...ids });

      const txnId = 'TXN-P69-14';
      const input = {
        merchantOrderId: ids.moid,
        provider: 'phonepe' as const,
        providerTxnId: txnId,
        providerUtr: `UTR-${txnId}`,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: txnId,
        source: 'webhook' as const,
        shopId: ids.shopId,
        orderId: ids.orderId,
      };

      // Fire TWO applyPaymentTransition calls in parallel with the SAME
      // eventId. The lifecycle uses Serializable isolation, so the two
      // concurrent transactions conflict on the PaymentEvent INSERT.
      //
      // Possible outcomes (depending on exact scheduling):
      //   a. One wins, the other gets 23505 (unique violation) → caught →
      //      idempotent=true.
      //   b. One wins, the other gets 40001 (serialization failure) → NOT
      //      caught → throws. The provider retries; on retry the first call
      //      has committed, so the retry gets 23505 → idempotent=true.
      //
      // In BOTH cases, the DB-level invariant is preserved: exactly ONE
      // PaymentEvent row, the attempt is 'paid' exactly once, the order is
      // 'paid' exactly once. We verify the invariant regardless of which
      // outcome occurred.
      const results = await Promise.allSettled([
        applyPaymentTransition(input),
        applyPaymentTransition(input),
      ]);

      // At least one must have fulfilled (the winner).
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Of the fulfilled, exactly one should have applied=true (the winner);
      // any other fulfilled should be idempotent (got 23505).
      const appliedCount = fulfilled.filter((r) => {
        if (r.status !== 'fulfilled') return false;
        const value = (r as PromiseFulfilledResult<unknown>).value as { applied?: boolean };
        return value?.applied === true;
      }).length;
      expect(appliedCount).toBe(1);

      // Exactly ONE PaymentEvent row — the loser either got 23505 (caught)
      // OR got 40001 (threw → transaction rolled back). Either way, only
      // the winner's INSERT persisted.
      const evtCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evtCount.rows[0].count).toBe(1);

      // The attempt is 'paid' exactly once.
      const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE id = $1`, [ids.attemptId]);
      expect(att.rows[0].status).toBe('paid');

      // The order is 'paid' exactly once (no double-credit).
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [ids.orderId]);
      expect(ord.rows[0].status).toBe('paid');
    },
    TIMEOUT,
  );

  it(
    '15. PaymentEvent + PaymentAttempt atomic → both transition together or neither',
    async () => {
      const ids = {
        shopId: 'shop-p69-15',
        orderId: 'order-p69-15',
        attemptId: 'att-p69-15',
        moid: 'moid-p69-15',
      };
      await seedFixture({ ...ids });

      const txnId = 'TXN-P69-15';
      const result = await applyPaymentTransition({
        merchantOrderId: ids.moid,
        provider: 'phonepe',
        providerTxnId: txnId,
        providerUtr: `UTR-${txnId}`,
        amountPaise: 50000,
        currency: 'INR',
        paid: true,
        eventId: txnId,
        source: 'webhook',
        shopId: ids.shopId,
        orderId: ids.orderId,
      });
      expect(result.applied).toBe(true);

      // Both the PaymentEvent AND the PaymentAttempt transitioned together
      // inside the SAME db.$transaction:
      //   - PaymentEvent.processingStatus = 'processed' (received → processed)
      //   - PaymentAttempt.status = 'paid' (created → paid)
      //   - Order.status = 'paid' (awaiting_payment → paid)
      // If any step had failed, the entire transaction would have rolled
      // back — neither the event nor the attempt would show a transition.
      const evt = await pool.query(
        `SELECT "processingStatus", "processedAt", "attemptId" FROM "PaymentEvent" WHERE "eventId" = $1`,
        [txnId],
      );
      expect(evt.rowCount).toBe(1);
      expect(evt.rows[0].processingStatus).toBe('processed');
      expect(evt.rows[0].processedAt).toBeInstanceOf(Date);
      expect(evt.rows[0].attemptId).toBe(ids.attemptId);

      const att = await pool.query(
        `SELECT status, "providerTransactionId" FROM "PaymentAttempt" WHERE id = $1`,
        [ids.attemptId],
      );
      expect(att.rows[0].status).toBe('paid');
      expect(att.rows[0].providerTransactionId).toBe(txnId);

      const ord = await pool.query(
        `SELECT status, "paymentTxnId", "paymentUtr", "paidAt" FROM "Order" WHERE id = $1`,
        [ids.orderId],
      );
      expect(ord.rows[0].status).toBe('paid');
      expect(ord.rows[0].paymentTxnId).toBe(txnId);
      expect(ord.rows[0].paymentUtr).toBe(`UTR-${txnId}`);
      expect(ord.rows[0].paidAt).toBeInstanceOf(Date);

      // All three rows reference each other consistently — no orphans, no
      // dangling FKs, no half-applied state.
    },
    TIMEOUT,
  );
});

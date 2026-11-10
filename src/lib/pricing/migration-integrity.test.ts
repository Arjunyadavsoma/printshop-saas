import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, Client } from 'pg';

/**
 * Phase 6.8 — Migration Chain Integrity Regression Tests
 *
 * These tests run against a CLEAN PostgreSQL database (`printshop_clean`)
 * whose schema is produced entirely by `prisma migrate deploy` against the
 * 4 migrations in `prisma/migrations/`:
 *
 *   1. 20251107000000_init                              — Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription, AuditLog
 *   2. 20251108000000_add_delivery_and_sync             — DeviceSyncState, Customer, PrintDeliveryAttempt, FileCleanupTask
 *   3. 20251110000000_add_active_attempt_unique_index   — PaymentAttempt, PaymentEvent + partial unique index
 *   4. 20261015172035_add_payment_fk_constraints        — FK constraints for PaymentAttempt + PaymentEvent
 *
 * Verifying that `prisma migrate deploy` (NOT `prisma db push` and NOT a
 * hand-rolled schema) creates the database objects the application code
 * depends on at runtime:
 *
 *   - The partial unique index `PaymentAttempt_active_order_unique`
 *     ON (orderId) WHERE status = 'created' — the race-condition guard
 *     that ensures at most one ACTIVE PaymentAttempt per Order.
 *   - The FK constraint `PaymentEvent_attemptId_fkey` → PaymentAttempt(id)
 *     — the Phase 6.6 P0 fix that prevents orderId from being persisted as
 *     the attemptId.
 *   - The UNIQUE([provider, eventId]) index on PaymentEvent — the webhook
 *     idempotency guard.
 *   - The FK PaymentAttempt_orderId_fkey → Order(id) — tenant/order
 *     integrity.
 *
 * Scenarios (all raw SQL against the migration-created schema, no Prisma
 * client involved — we are testing the DB-level invariants the migrations
 * are responsible for):
 *
 *   1. Shop + Order + PaymentAttempt INSERT → succeeds
 *   2. PaymentEvent with correct attemptId → succeeds (FK satisfied)
 *   3. PaymentEvent with orderId as attemptId → fails 23503 (FK violation)
 *      [Phase 6.6 P0 regression guard]
 *   4. Duplicate PaymentAttempt with status='created' for same order →
 *      fails 23505 (partial unique index)
 *   5. Duplicate PaymentEvent (same provider+eventId) → fails 23505
 *      (unique constraint)
 *   6. Expired attempt → new 'created' attempt succeeds (partial index
 *      allows multiple non-active attempts per order)
 *   7. Concurrent INSERT (10 connections) → exactly 1 succeeds
 *
 * Environment:
 *   TEST_DATABASE_URL=postgresql://z@127.0.0.1:5433/printshop_clean
 *
 * The clean database is created by Task 3 of the Phase 6.8 procedure:
 *
 *   psql -c "DROP DATABASE IF EXISTS printshop_clean;"
 *   psql -c "CREATE DATABASE printshop_clean;"
 *   DATABASE_URL=postgresql://z@127.0.0.1:5433/printshop_clean \
 *     bunx prisma migrate deploy
 */

const DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://z@127.0.0.1:5433/printshop_clean';
const TIMEOUT = 30_000;

// ─── Fixture helpers ────────────────────────────────────────────────────

interface FixtureIds {
  shopId: string;
  orderId: string;
  attemptId: string;
  merchantOrderId: string;
}

async function seedShopAndOrder(
  pool: Pool,
  shopId: string,
  orderId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, "timezone", "isActive", "subscriptionTier", "createdAt", "updatedAt")
     VALUES ($1, 'Migration Integrity Shop', $2, 'user-mi', 'mi@okaxis', 'phonepe', '{}', '{}', 'addr', '555', 'Asia/Kolkata', true, 'free', NOW(), NOW())`,
    [shopId, `mi-${shopId.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'awaiting_payment', 50000, 'INR', NOW(), NOW())`,
    [orderId, shopId, `TOK${orderId.slice(0, 6)}`],
  );
}

async function seedFullFixture(
  pool: Pool,
  ids: FixtureIds,
  opts: { status?: string; amountPaise?: number } = {},
): Promise<void> {
  await seedShopAndOrder(pool, ids.shopId, ids.orderId);
  const status = opts.status ?? 'created';
  const amount = opts.amountPaise ?? 50000;
  await pool.query(
    `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'phonepe', $4, $5, 'INR', $6, NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
    [ids.attemptId, ids.shopId, ids.orderId, ids.merchantOrderId, amount, status],
  );
}

async function cleanAll(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM "PaymentEvent"');
  await pool.query('DELETE FROM "PaymentAttempt"');
  await pool.query('DELETE FROM "Order"');
  await pool.query('DELETE FROM "Shop"');
}

// ─── Test suite ─────────────────────────────────────────────────────────

describe('Phase 6.8 — Migration chain integrity (prisma migrate deploy schema)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 15 });
    // Verify we are talking to PostgreSQL.
    const v = await pool.query('SELECT version()');
    expect(v.rows[0].version).toContain('PostgreSQL');

    // Verify the partial unique index exists (created by migration 3).
    const idx = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname = 'PaymentAttempt_active_order_unique'`,
    );
    expect(idx.rowCount).toBe(1);
    expect(idx.rows[0].indexdef).toContain('WHERE (status = \'created\'::text)');
    expect(idx.rows[0].indexdef).toContain('UNIQUE');

    // Verify the FK on PaymentEvent.attemptId exists (added by migration 4).
    const fk = await pool.query(
      `SELECT conname, conrelid::regclass AS tbl, confrelid::regclass AS ref
       FROM pg_constraint
       WHERE conname = 'PaymentEvent_attemptId_fkey' AND contype = 'f'`,
    );
    expect(fk.rowCount).toBe(1);
    expect(String(fk.rows[0].tbl)).toContain('PaymentEvent');
    expect(String(fk.rows[0].ref)).toContain('PaymentAttempt');

    // Verify the UNIQUE([provider, eventId]) on PaymentEvent.
    const uq = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE indexname = 'PaymentEvent_provider_eventId_key'`,
    );
    expect(uq.rowCount).toBe(1);

    // Verify PaymentAttempt_orderId_fkey → Order(id).
    const fkOrder = await pool.query(
      `SELECT conname, confrelid::regclass AS ref
       FROM pg_constraint
       WHERE conname = 'PaymentAttempt_orderId_fkey' AND contype = 'f'`,
    );
    expect(fkOrder.rowCount).toBe(1);
    expect(String(fkOrder.rows[0].ref)).toContain('Order');
  }, TIMEOUT);

  afterAll(async () => {
    if (pool) await pool.end();
  }, TIMEOUT);

  beforeEach(async () => {
    await cleanAll(pool);
  }, TIMEOUT);

  // ── 1. Baseline: Shop + Order + PaymentAttempt INSERT succeeds ──────
  it('1. Shop + Order + PaymentAttempt INSERT → succeeds (baseline fixture)', async () => {
    const ids: FixtureIds = {
      shopId: 'shop-mi-1',
      orderId: 'order-mi-1',
      attemptId: 'att-mi-1',
      merchantOrderId: 'moid-mi-1',
    };
    await seedFullFixture(pool, ids);

    const shop = await pool.query('SELECT id, name FROM "Shop" WHERE id = $1', [ids.shopId]);
    expect(shop.rowCount).toBe(1);
    expect(shop.rows[0].name).toBe('Migration Integrity Shop');

    const order = await pool.query(
      'SELECT id, status, "totalAmountPaise" FROM "Order" WHERE id = $1',
      [ids.orderId],
    );
    expect(order.rowCount).toBe(1);
    expect(order.rows[0].status).toBe('awaiting_payment');
    expect(order.rows[0].totalAmountPaise).toBe(50000);

    const att = await pool.query(
      'SELECT id, status, "merchantOrderId" FROM "PaymentAttempt" WHERE id = $1',
      [ids.attemptId],
    );
    expect(att.rowCount).toBe(1);
    expect(att.rows[0].status).toBe('created');
    expect(att.rows[0].merchantOrderId).toBe(ids.merchantOrderId);
  }, TIMEOUT);

  // ── 2. PaymentEvent with correct attemptId succeeds ────────────────
  it('2. PaymentEvent with correct attemptId → succeeds (FK satisfied)', async () => {
    const ids: FixtureIds = {
      shopId: 'shop-mi-2',
      orderId: 'order-mi-2',
      attemptId: 'att-mi-2',
      merchantOrderId: 'moid-mi-2',
    };
    await seedFullFixture(pool, ids);

    await pool.query(
      `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "eventType", "signatureValid", "processingStatus", "receivedAt")
       VALUES ($1, $2, 'phonepe', $3, $4, 'webhook', true, 'received', NOW())`,
      ['evt-mi-2', ids.attemptId, 'TXN-MI-2', ids.merchantOrderId],
    );

    const evt = await pool.query(
      `SELECT id, "attemptId", provider, "eventId", "processingStatus"
       FROM "PaymentEvent" WHERE id = $1`,
      ['evt-mi-2'],
    );
    expect(evt.rowCount).toBe(1);
    expect(evt.rows[0].attemptId).toBe(ids.attemptId);
    expect(evt.rows[0].provider).toBe('phonepe');
    expect(evt.rows[0].eventId).toBe('TXN-MI-2');
    expect(evt.rows[0].processingStatus).toBe('received');
  }, TIMEOUT);

  // ── 3. PaymentEvent with orderId as attemptId → 23503 (P0 regression) ─
  it('3. PaymentEvent with orderId as attemptId → fails 23503 (FK violation)', async () => {
    const ids: FixtureIds = {
      shopId: 'shop-mi-3',
      orderId: 'order-mi-3',
      attemptId: 'att-mi-3',
      merchantOrderId: 'moid-mi-3',
    };
    await seedFullFixture(pool, ids);

    // Phase 6.6 P0 bug: the lifecycle service passed orderId (an Order UUID)
    // as the attemptId. The FK on PaymentEvent.attemptId → PaymentAttempt.id
    // now catches this. This test verifies the FK is enforced by the
    // migration-created constraint.
    try {
      await pool.query(
        `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "eventType", "signatureValid", "processingStatus", "receivedAt")
         VALUES ($1, $2, 'phonepe', 'TXN-BAD', 'webhook', true, 'received', NOW())`,
        ['evt-mi-bad', ids.orderId],
      );
      expect.fail('expected FK violation (23503) was not raised');
    } catch (e: unknown) {
      const err = e as { code?: string };
      expect(err.code).toBe('23503'); // foreign_key_violation
    }

    const r = await pool.query(
      'SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE id = $1',
      ['evt-mi-bad'],
    );
    expect(r.rows[0].count).toBe(0);
  }, TIMEOUT);

  // ── 4. Duplicate active PaymentAttempt → 23505 (partial unique index) ─
  it('4. Duplicate PaymentAttempt with status=created for same order → fails 23505 (partial unique index)', async () => {
    const ids: FixtureIds = {
      shopId: 'shop-mi-4',
      orderId: 'order-mi-4',
      attemptId: 'att-mi-4',
      merchantOrderId: 'moid-mi-4',
    };
    await seedFullFixture(pool, ids);

    // Second 'created' attempt for the SAME order — must fail with 23505
    // because the partial unique index allows only one active attempt.
    try {
      await pool.query(
        `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'phonepe', $4, 50000, 'INR', 'created', NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
        ['att-mi-4-dup', ids.shopId, ids.orderId, 'moid-mi-4-dup'],
      );
      expect.fail('expected UNIQUE violation (23505) was not raised');
    } catch (e: unknown) {
      const err = e as { code?: string };
      expect(err.code).toBe('23505'); // unique_violation
    }

    const c = await pool.query(
      'SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2',
      [ids.orderId, 'created'],
    );
    expect(c.rows[0].count).toBe(1);
  }, TIMEOUT);

  // ── 5. Duplicate PaymentEvent (same provider+eventId) → 23505 ───────
  it('5. Duplicate PaymentEvent (same provider+eventId) → fails 23505 (unique constraint)', async () => {
    const ids: FixtureIds = {
      shopId: 'shop-mi-5',
      orderId: 'order-mi-5',
      attemptId: 'att-mi-5',
      merchantOrderId: 'moid-mi-5',
    };
    await seedFullFixture(pool, ids);

    await pool.query(
      `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "eventType", "signatureValid", "processingStatus", "receivedAt")
       VALUES ($1, $2, 'phonepe', $3, $4, 'webhook', true, 'received', NOW())`,
      ['evt-mi-5a', ids.attemptId, 'TXN-MI-5', ids.merchantOrderId],
    );

    // Duplicate (provider, eventId) — must fail with 23505.
    try {
      await pool.query(
        `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "eventType", "signatureValid", "processingStatus", "receivedAt")
         VALUES ($1, $2, 'phonepe', $3, $4, 'webhook', true, 'received', NOW())`,
        ['evt-mi-5b', ids.attemptId, 'TXN-MI-5', ids.merchantOrderId],
      );
      expect.fail('expected UNIQUE violation (23505) was not raised');
    } catch (e: unknown) {
      const err = e as { code?: string };
      expect(err.code).toBe('23505'); // unique_violation
    }

    const c = await pool.query(
      'SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE "eventId" = $1',
      ['TXN-MI-5'],
    );
    expect(c.rows[0].count).toBe(1);
  }, TIMEOUT);

  // ── 6. Expired attempt → new 'created' attempt succeeds ─────────────
  it('6. Expired attempt → new created attempt succeeds (partial index allows)', async () => {
    const ids: FixtureIds = {
      shopId: 'shop-mi-6',
      orderId: 'order-mi-6',
      attemptId: 'att-mi-6-old',
      merchantOrderId: 'moid-mi-6-old',
    };
    // Seed an attempt, then mark it expired (simulates lifecycle timeout).
    await seedFullFixture(pool, ids);
    await pool.query(
      `UPDATE "PaymentAttempt" SET status = 'expired', "updatedAt" = NOW() WHERE id = $1`,
      [ids.attemptId],
    );

    // A new 'created' attempt for the SAME order must now succeed — the
    // partial index only constrains WHERE status = 'created', so any number
    // of expired/failed/paid attempts can coexist with one active one.
    await pool.query(
      `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'phonepe', $4, 50000, 'INR', 'created', NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
      ['att-mi-6-new', ids.shopId, ids.orderId, 'moid-mi-6-new'],
    );

    const total = await pool.query(
      'SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1',
      [ids.orderId],
    );
    expect(total.rows[0].count).toBe(2);

    const active = await pool.query(
      'SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2',
      [ids.orderId, 'created'],
    );
    expect(active.rows[0].count).toBe(1);

    const expired = await pool.query(
      'SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2',
      [ids.orderId, 'expired'],
    );
    expect(expired.rows[0].count).toBe(1);
  }, TIMEOUT);

  // ── 7. Concurrent INSERT (10 connections) → exactly 1 succeeds ─────
  it('7. Concurrent INSERT (10 independent connections) → exactly 1 succeeds', async () => {
    const ids: FixtureIds = {
      shopId: 'shop-mi-7',
      orderId: 'order-mi-7',
      attemptId: 'att-mi-7',
      merchantOrderId: 'moid-mi-7',
    };
    await seedShopAndOrder(pool, ids.shopId, ids.orderId);

    // 10 INDEPENDENT TCP connections (not a shared client) all racing to
    // INSERT a 'created' PaymentAttempt for the same order. The partial
    // unique index must serialize them: exactly ONE succeeds, the other 9
    // get 23505 (unique_violation).
    const clients: Client[] = [];
    for (let i = 0; i < 10; i++) {
      const c = new Client({ connectionString: DB_URL });
      await c.connect();
      clients.push(c);
    }
    try {
      type Result = { success: boolean; errorCode?: string };
      const results: Result[] = await Promise.all(
        clients.map((c, i) =>
          c
            .query(
              `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, 'phonepe', $4, 50000, 'INR', 'created', NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
              [`att-mi-7-${i}`, ids.shopId, ids.orderId, `moid-mi-7-${i}`],
            )
            .then(
              (): Result => ({ success: true }),
            )
            .catch(
              (e: { code?: string }): Result => ({
                success: false,
                errorCode: e.code,
              }),
            ),
        ),
      );

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(9);
      for (const f of failures) {
        expect(f.errorCode).toBe('23505');
      }

      const c = await pool.query(
        'SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2',
        [ids.orderId, 'created'],
      );
      expect(c.rows[0].count).toBe(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  }, TIMEOUT);
});

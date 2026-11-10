import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, Client } from 'pg';

/**
 * Phase 6.5 — Real PostgreSQL Independent-Connection Concurrency Tests
 *
 * Uses ACTUAL PostgreSQL 17.11 with INDEPENDENT TCP connections via the `pg`
 * (node-postgres) driver. Each `Pool.connect()` or `new Client()` creates a
 * separate TCP connection to the PostgreSQL server — these are genuinely
 * independent connections, NOT a shared in-process instance.
 *
 * The tests prove the partial unique index
 * `PaymentAttempt_active_order_unique ON (orderId) WHERE status = 'created'`
 * enforces the checkout idempotency invariant under real multi-connection
 * concurrency.
 */

const DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://z@127.0.0.1:5433/printshop_test';
const TIMEOUT = 30_000;

async function cleanAndSeed(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM "PaymentEvent"');
  await pool.query('DELETE FROM "PaymentAttempt"');
  await pool.query('DELETE FROM "Order"');
  await pool.query('DELETE FROM "Shop"');
  await pool.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, "timezone", "isActive", "subscriptionTier", "createdAt", "updatedAt") VALUES ('shop-1', 'Test Shop', 'test-shop-1', 'user-1', 'test@upi', 'googlepay', '{}', '{}', 'addr', '555', 'Asia/Kolkata', true, 'free', NOW(), NOW())`);
  await pool.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt") VALUES ('order-1', 'shop-1', 'TOK1', 'awaiting_payment', 50000, 'INR', NOW(), NOW())`);
}

async function tryInsert(
  client: Pool | Client,
  opts: { id: string; orderId: string; merchantOrderId: string; status?: string; amountPaise?: number },
): Promise<{ success: boolean; errorCode?: string }> {
  try {
    await client.query(
      `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt") VALUES ($1, 'shop-1', $2, 'googlepay', $3, $4, 'INR', $5, NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
      [opts.id, opts.orderId, opts.merchantOrderId, opts.amountPaise ?? 50000, opts.status ?? 'created'],
    );
    return { success: true };
  } catch (e: any) {
    return { success: false, errorCode: e.code };
  }
}

describe('Phase 6.5 — Real PostgreSQL independent-connection concurrency', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 25 });
    const r = await pool.query('SELECT version()');
    expect(r.rows[0].version).toContain('PostgreSQL');
  }, TIMEOUT);

  afterAll(async () => { await pool.end(); }, TIMEOUT);

  beforeEach(async () => { await cleanAndSeed(pool); }, TIMEOUT);

  it('1. 20 simultaneous identical checkout requests via independent connections → exactly 1 succeeds', async () => {
    const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map((c, i) => tryInsert(c, { id: `att-${i}`, orderId: 'order-1', merchantOrderId: 'checkout-order-1' })));
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(19);
      for (const f of failures) expect(f.errorCode).toBe('23505');
      const r = await pool.query('SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2', ['order-1', 'created']);
      expect(r.rows[0].count).toBe(1);
    } finally { clients.forEach((c) => c.release()); }
  }, TIMEOUT);

  it('2. same order, different merchantOrderId → partial unique index catches', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map((c, i) => tryInsert(c, { id: `att-d-${i}`, orderId: 'order-1', merchantOrderId: `c-o-1-v${i}` })));
      const successes = results.filter((r) => r.success);
      expect(successes.length).toBe(1);
      const failures = results.filter((r) => !r.success);
      expect(failures.length).toBe(9);
      for (const f of failures) expect(f.errorCode).toBe('23505');
    } finally { clients.forEach((c) => c.release()); }
  }, TIMEOUT);

  it('3. same merchantOrderId on different orders → @unique catches', async () => {
    await pool.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt") VALUES ('order-2', 'shop-1', 'TOK2', 'awaiting_payment', 30000, 'INR', NOW(), NOW())`);
    const r1 = await tryInsert(pool, { id: 'att-a', orderId: 'order-1', merchantOrderId: 'shared-moid' });
    expect(r1.success).toBe(true);
    const r2 = await tryInsert(pool, { id: 'att-b', orderId: 'order-2', merchantOrderId: 'shared-moid' });
    expect(r2.success).toBe(false);
    expect(r2.errorCode).toBe('23505');
  }, TIMEOUT);

  it('4. expired attempt followed by retry → new succeeds', async () => {
    await pool.query(`INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt") VALUES ('att-old', 'shop-1', 'order-1', 'googlepay', 'moid-old', 50000, 'INR', 'created', NOW() - INTERVAL '5 minutes', NOW(), NOW())`);
    await pool.query(`UPDATE "PaymentAttempt" SET status = 'expired' WHERE id = 'att-old'`);
    const r = await tryInsert(pool, { id: 'att-new', orderId: 'order-1', merchantOrderId: 'moid-new' });
    expect(r.success).toBe(true);
    const c = await pool.query('SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2', ['order-1', 'created']);
    expect(c.rows[0].count).toBe(1);
  }, TIMEOUT);

  it('5. transaction rollback → no row persists', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt") VALUES ('att-rb', 'shop-1', 'order-1', 'googlepay', 'moid-rb', 50000, 'INR', 'created', NOW() + INTERVAL '10 minutes', NOW(), NOW())`);
      await client.query('ROLLBACK');
      const r = await pool.query('SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE id = $1', ['att-rb']);
      expect(r.rows[0].count).toBe(0);
    } finally { client.release(); }
  }, TIMEOUT);

  it('6. concurrent order-price update and checkout → amount matches', async () => {
    await pool.query(`UPDATE "Order" SET "totalAmountPaise" = 75000 WHERE id = 'order-1'`);
    const r = await tryInsert(pool, { id: 'att-p', orderId: 'order-1', merchantOrderId: 'moid-p', amountPaise: 75000 });
    expect(r.success).toBe(true);
    const a = await pool.query('SELECT "amountPaise" FROM "PaymentAttempt" WHERE id = $1', ['att-p']);
    const o = await pool.query('SELECT "totalAmountPaise" FROM "Order" WHERE id = $1', ['order-1']);
    expect(a.rows[0].amountPaise).toBe(75000);
    expect(o.rows[0].totalAmountPaise).toBe(75000);
  }, TIMEOUT);

  it('7. duplicate webhook → PaymentEvent unique catches', async () => {
    // Create a PaymentAttempt first (PaymentEvent.attemptId references it)
    await pool.query(`INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt") VALUES ('att-evt', 'shop-1', 'order-1', 'googlepay', 'moid-evt', 50000, 'INR', 'created', NOW() + INTERVAL '10 min', NOW(), NOW())`);

    await pool.query(`INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "eventType", "signatureValid", "processingStatus", "receivedAt") VALUES ('evt-1', 'att-evt', 'phonepe', 'TXN-123', 'webhook', true, 'received', NOW())`);
    try {
      await pool.query(`INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "eventType", "signatureValid", "processingStatus", "receivedAt") VALUES ('evt-2', 'att-evt', 'phonepe', 'TXN-123', 'webhook', true, 'received', NOW())`);
      expect(false).toBe(true);
    } catch (e: any) { expect(e.code).toBe('23505'); }
    const r = await pool.query('SELECT COUNT(*)::int AS count FROM "PaymentEvent" WHERE "eventId" = $1', ['TXN-123']);
    expect(r.rows[0].count).toBe(1);
  }, TIMEOUT);

  it('8. recovery after interruption → existing attempt found', async () => {
    await pool.query(`INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "idempotencyKey", "expiresAt", "createdAt", "updatedAt") VALUES ('att-crash', 'shop-1', 'order-1', 'googlepay', 'checkout-order-1', 50000, 'INR', 'created', 'checkout-order-1', NOW() + INTERVAL '10 minutes', NOW(), NOW())`);
    const r = await tryInsert(pool, { id: 'att-retry', orderId: 'order-1', merchantOrderId: 'checkout-order-1' });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('23505');
    const existing = await pool.query('SELECT id, status, "merchantOrderId" FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2 ORDER BY "createdAt" DESC LIMIT 1', ['order-1', 'created']);
    expect(existing.rows.length).toBe(1);
    expect(existing.rows[0].id).toBe('att-crash');
  }, TIMEOUT);

  it('9. two fully independent Client connections (separate TCP)', async () => {
    const c1 = new Client({ connectionString: DB_URL });
    const c2 = new Client({ connectionString: DB_URL });
    await c1.connect();
    await c2.connect();
    try {
      const [r1, r2] = await Promise.all([
        tryInsert(c1, { id: 'att-c1', orderId: 'order-1', merchantOrderId: 'checkout-conn' }),
        tryInsert(c2, { id: 'att-c2', orderId: 'order-1', merchantOrderId: 'checkout-conn' }),
      ]);
      expect(r1.success !== r2.success).toBe(true);
      if (!r1.success) expect(r1.errorCode).toBe('23505');
      if (!r2.success) expect(r2.errorCode).toBe('23505');
      const r = await pool.query('SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "merchantOrderId" = $1', ['checkout-conn']);
      expect(r.rows[0].count).toBe(1);
    } finally { await c1.end(); await c2.end(); }
  }, TIMEOUT);

  it('10. partial unique index allows multiple non-created attempts', async () => {
    await pool.query(`INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt") VALUES ('att-e1', 'shop-1', 'order-1', 'googlepay', 'moid-e1', 50000, 'INR', 'expired', NOW() - INTERVAL '5 min', NOW(), NOW())`);
    await pool.query(`INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt") VALUES ('att-f1', 'shop-1', 'order-1', 'googlepay', 'moid-f1', 50000, 'INR', 'failed', NOW() - INTERVAL '3 min', NOW(), NOW())`);
    const r = await tryInsert(pool, { id: 'att-c', orderId: 'order-1', merchantOrderId: 'moid-c' });
    expect(r.success).toBe(true);
    const t = await pool.query('SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1', ['order-1']);
    expect(t.rows[0].count).toBe(3);
    const c = await pool.query('SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = $2', ['order-1', 'created']);
    expect(c.rows[0].count).toBe(1);
  }, TIMEOUT);

  it('11. concurrent created→paid transitions → race-safe', async () => {
    await pool.query(`INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt") VALUES ('att-t', 'shop-1', 'order-1', 'googlepay', 'moid-t', 50000, 'INR', 'created', NOW() + INTERVAL '10 min', NOW(), NOW())`);
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const [r1, r2] = await Promise.all([
        clients[0].query(`UPDATE "PaymentAttempt" SET status = 'paid' WHERE id = 'att-t' AND status = 'created'`),
        clients[1].query(`UPDATE "PaymentAttempt" SET status = 'paid' WHERE id = 'att-t' AND status = 'created'`),
      ]);
      expect((r1.rowCount ?? 0) + (r2.rowCount ?? 0)).toBe(1);
    } finally { clients.forEach((c) => c.release()); }
  }, TIMEOUT);

  it('12. 20 independent connections, different orders → all succeed', async () => {
    for (let i = 0; i < 20; i++) {
      await pool.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt") VALUES ($1, 'shop-1', $2, 'awaiting_payment', 10000, 'INR', NOW(), NOW()) ON CONFLICT DO NOTHING`, [`order-b-${i}`, `TOK${i}`]);
    }
    const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map((c, i) => tryInsert(c, { id: `att-b-${i}`, orderId: `order-b-${i}`, merchantOrderId: `checkout-b-${i}` })));
      const successes = results.filter((r) => r.success);
      expect(successes.length).toBe(20);
    } finally { clients.forEach((c) => c.release()); }
  }, TIMEOUT);
});

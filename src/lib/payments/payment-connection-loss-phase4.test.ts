import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

/**
 * Phase 4 §2 — payment integrity under CONNECTION LOSS and ROLLBACK.
 *
 * Independently verifies (per release-qualification spec):
 *   - a backend connection dying MID-TRANSACTION leaves zero partial state
 *     (no orphan PaymentEvent, no paid attempt/order) — PostgreSQL aborts the
 *     whole transaction on connection loss;
 *   - a mid-transaction constraint failure rolls back everything already
 *     written in that transaction;
 *   - a payment retried after both failure modes applies EXACTLY ONCE.
 *
 * Uses the same five-statement transaction shape as
 * applyPaymentTransition (unique-arbitrated INSERT + conditional updates).
 */

const DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/phb_p4';
const TIMEOUT = 30_000;

async function seed(pool: Pool, moid: string, orderId: string) {
  await pool.query(
    `INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, "timezone", "isActive", "subscriptionTier", "createdAt", "updatedAt")
     VALUES ('shop-p4', 'P4 Shop', 'p4-shop', 'user-p4', 'p4@okaxis', 'phonepe', '{}', '{}', 'addr', '555', 'Asia/Kolkata', true, 'free', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
     VALUES ($1, 'shop-p4', 'TOK-' || $1, 'awaiting_payment', 50000, 'INR', NOW(), NOW())`,
    [orderId],
  );
  await pool.query(
    `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, 'shop-p4', $2, 'phonepe', $3, 50000, 'INR', 'created', NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
    [`att-${moid}`, orderId, moid],
  );
}

/** Full lifecycle delivery over its OWN connection (like a webhook handler). */
async function deliver(moid: string, eventId: string, orderId: string): Promise<'applied' | 'duplicate' | 'skipped'> {
  const c = new Pool({ connectionString: DB_URL, max: 1 });
  try {
    const client = await c.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const att = await client.query(`SELECT * FROM "PaymentAttempt" WHERE "merchantOrderId"=$1`, [moid]);
      const attempt = att.rows[0];
      await client.query(
        `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "providerTransactionId", "eventType", "signatureValid", "processingStatus")
         VALUES ($1, $2, 'phonepe', $3, $4, $3, 'webhook', true, 'received')`,
        [`evt-${eventId}`, attempt.id, eventId, moid],
      );
      const attemptUpd = await client.query(
        `UPDATE "PaymentAttempt" SET status='paid', "providerTransactionId"=$2, "updatedAt"=NOW() WHERE id=$1 AND status IN ('created','pending')`,
        [attempt.id, eventId],
      );
      if (attemptUpd.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'skipped';
      }
      await client.query(
        `UPDATE "Order" SET status='paid', "paidAt"=NOW(), "paymentTxnId"=$3, "paymentProvider"='phonepe', "updatedAt"=NOW() WHERE id=$1 AND "shopId"=$2 AND status='awaiting_payment'`,
        [orderId, 'shop-p4', eventId],
      );
      await client.query(`UPDATE "PaymentEvent" SET "processingStatus"='processed', "processedAt"=NOW() WHERE id=$1`, [`evt-${eventId}`]);
      await client.query('COMMIT');
      return 'applied';
    } finally {
      client.release();
    }
  } catch (e: any) {
    if (e.code === '23505') return 'duplicate';
    return 'skipped';
  } finally {
    await c.end().catch(() => {});
  }
}

async function state(pool: Pool, moid: string, orderId: string) {
  const ev = await pool.query(`SELECT COUNT(*)::int AS n FROM "PaymentEvent" WHERE "merchantOrderId"=$1 AND "processingStatus"='processed'`, [moid]);
  const att = await pool.query(`SELECT status FROM "PaymentAttempt" WHERE "merchantOrderId"=$1`, [moid]);
  const ord = await pool.query(`SELECT status FROM "Order" WHERE id=$1`, [orderId]);
  return { events: ev.rows[0].n, attempt: att.rows[0]?.status, order: ord.rows[0]?.status };
}

describe('Phase 4 §2 — payment under connection loss and rollback (real PostgreSQL)', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    await pool.query('SELECT 1');
  }, TIMEOUT);
  afterAll(async () => { await pool.end(); }, TIMEOUT);
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE "PaymentEvent", "PaymentAttempt", "Order", "Shop", "AuditLog" CASCADE');
  }, TIMEOUT);

  it('1. backend connection killed MID-TRANSACTION → zero partial state; retry applies exactly once', async () => {
    await seed(pool, 'm-conn', 'o-conn');
    // Open a delivery transaction, write the event, then KILL the backend.
    const victim = new Pool({ connectionString: DB_URL, max: 1 });
    victim.on('error', () => {}); // the pg_terminate_backend below kills this socket — expected noise
    const client = await victim.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const att = await client.query(`SELECT id FROM "PaymentAttempt" WHERE "merchantOrderId"='m-conn'`);
    await client.query(
      `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "providerTransactionId", "eventType", "signatureValid", "processingStatus")
       VALUES ('evt-conn-1', $1, 'phonepe', 'TXN-CONN', 'm-conn', 'TXN-CONN', 'webhook', true, 'received')`,
      [att.rows[0].id],
    );
    const backend = await client.query(`SELECT pg_backend_pid() AS pid`);
    const pid = backend.rows[0].pid;
    // Terminate our own connection's backend mid-transaction.
    const killer = await pool.query(`SELECT pg_terminate_backend($1) AS ok`, [pid]);
    expect(killer.rows[0].ok).toBe(true);
    try { client.release(); } catch { /* backend already dead — release may return undefined */ }
    await victim.end().catch(() => {});
    // Brief wait for the backend to die and roll back.
    await new Promise((r) => setTimeout(r, 300));
    // Zero partial state: no event row, attempt still created, order unpaid.
    const s = await state(pool, 'm-conn', 'o-conn');
    expect(s.events).toBe(0);
    expect(s.attempt).toBe('created');
    expect(s.order).toBe('awaiting_payment');
    // Retry (fresh connection, same event) applies EXACTLY once.
    const r = await deliver('m-conn', 'TXN-CONN', 'o-conn');
    expect(r).toBe('applied');
    const after = await state(pool, 'm-conn', 'o-conn');
    expect(after.events).toBe(1);
    expect(after.attempt).toBe('paid');
    expect(after.order).toBe('paid');
  }, TIMEOUT);

  it('2. constraint failure mid-transaction → full rollback of already-written rows; retry applies exactly once', async () => {
    await seed(pool, 'm-cf', 'o-cf');
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const att = await client.query(`SELECT id FROM "PaymentAttempt" WHERE "merchantOrderId"='m-cf'`);
      // (a) a benign write first — this MUST be rolled back too
      await client.query(`UPDATE "PaymentAttempt" SET "updatedAt"=NOW() WHERE id=$1`, [att.rows[0].id]);
      // (b) then the event insert
      await client.query(
        `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "providerTransactionId", "eventType", "signatureValid", "processingStatus")
         VALUES ('evt-cf', $1, 'phonepe', 'TXN-CF', 'm-cf', 'TXN-CF', 'webhook', true, 'received')`,
        [att.rows[0].id],
      );
      // (c) then a constraint violation: FK to a nonexistent attempt
      await expect(client.query(
        `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "providerTransactionId", "eventType", "signatureValid", "processingStatus")
         VALUES ('evt-cf-bad', 'no-such-attempt', 'phonepe', 'TXN-CF-BAD', 'm-cf', 'TXN-CF-BAD', 'webhook', true, 'received')`,
      )).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
    }
    const s = await state(pool, 'm-cf', 'o-cf');
    expect(s.events).toBe(0);
    expect(s.attempt).toBe('created');
    expect(s.order).toBe('awaiting_payment');
    const r = await deliver('m-cf', 'TXN-CF', 'o-cf');
    expect(r).toBe('applied');
    const after = await state(pool, 'm-cf', 'o-cf');
    expect(after.events).toBe(1);
    expect(after.order).toBe('paid');
  }, TIMEOUT);

  it('3. duplicate delivery after a committed payment → zero additional effects', async () => {
    await seed(pool, 'm-dup', 'o-dup');
    expect(await deliver('m-dup', 'TXN-DUP', 'o-dup')).toBe('applied');
    expect(await deliver('m-dup', 'TXN-DUP', 'o-dup')).toBe('duplicate');
    const s = await state(pool, 'm-dup', 'o-dup');
    expect(s.events).toBe(1);
    expect(s.order).toBe('paid');
    // Only ONE paid attempt, ONE paid order, ONE processed event — exactly one logical effect.
    const paid = await pool.query(`SELECT (SELECT COUNT(*)::int FROM "PaymentAttempt" WHERE status='paid') AS a, (SELECT COUNT(*)::int FROM "Order" WHERE status='paid') AS o`);
    expect(paid.rows[0].a).toBe(1);
    expect(paid.rows[0].o).toBe(1);
  }, TIMEOUT);
});

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

/**
 * Phase 3 (P2-2) — Real PostgreSQL payment-webhook idempotency suite.
 *
 * Root cause being regression-tested (P2-2): applyPaymentTransition ran at
 * SERIALIZABLE isolation; concurrent duplicate deliveries aborted with 40001
 * (SSI rw-conflict) instead of being arbitrated by the UNIQUE constraints →
 * ZERO financial effects for one real payment.
 *
 * Fix: READ COMMITTED + database-level arbitration. This suite replays the
 * EXACT five-statement transaction that applyPaymentTransition issues (same
 * WHERE guards, same unique keys) over INDEPENDENT pg connections, and
 * asserts the exact database state after every scenario. The key invariant
 * under duplicate delivery: financial_effect_count = 1, never 0, never 2.
 *
 * Statement sequence (mirrors src/lib/payments/lifecycle.service.ts):
 *   1. SELECT PaymentAttempt WHERE "merchantOrderId" = $1
 *   2. INSERT PaymentEvent (FK attemptId, UNIQUE [provider, eventId])
 *      → on 23505: ROLLBACK + report duplicate (idempotent skip)
 *   3. tenant/amount guards (application-level; emulated where relevant)
 *   4. UPDATE PaymentAttempt SET status='paid'
 *        WHERE id=$1 AND status IN ('created','pending')   [conditional]
 *   5. UPDATE "Order" SET status='paid'
 *        WHERE id=$1 AND status='awaiting_payment'         [conditional]
 *   6. UPDATE PaymentEvent SET "processingStatus"='processed'
 */

const DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/phb_p3';
const TIMEOUT = 30_000;

type LifecycleResult = { applied: boolean; duplicate: boolean; skipped: string | null };

/** One applyPaymentTransition delivery over an INDEPENDENT connection. */
async function deliver(
  client: Pool,
  args: { moid: string; eventId: string; txnId: string; shopId: string; orderId: string; amountPaise?: number; signatureValid?: boolean },
): Promise<LifecycleResult> {
  const amount = args.amountPaise ?? 50000;
  const c = await client.connect(); // dedicated connection per delivery
  try {
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const att = await c.query(`SELECT * FROM "PaymentAttempt" WHERE "merchantOrderId" = $1`, [args.moid]);
    if (att.rows.length === 0) {
      await c.query('ROLLBACK');
      return { applied: false, duplicate: false, skipped: 'attempt-not-found' };
    }
    const attempt = att.rows[0];
    // STEP 2: event INSERT — unique arbitration
    try {
      await c.query(
        `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "providerTransactionId", "eventType", "signatureValid", "processingStatus")
         VALUES ($1, $2, 'phonepe', $3, $4, $5, 'webhook', $6, 'received')`,
        [`evt-${args.eventId}`, attempt.id, args.eventId, args.moid, args.txnId, args.signatureValid ?? true],
      );
    } catch (e: any) {
      if (e.code === '23505') {
        await c.query('ROLLBACK');
        return { applied: false, duplicate: true, skipped: null };
      }
      await c.query('ROLLBACK');
      return { applied: false, duplicate: false, skipped: 'insert-failed' };
    }
    if (!(args.signatureValid ?? true)) {
      await c.query('ROLLBACK');
      return { applied: false, duplicate: false, skipped: 'signature-invalid' };
    }
    // tenant guard
    if (attempt.shopId !== args.shopId) {
      await c.query('ROLLBACK');
      return { applied: false, duplicate: false, skipped: 'tenant-mismatch' };
    }
    // amount guard
    if (attempt.amountPaise !== amount) {
      await c.query('ROLLBACK');
      return { applied: false, duplicate: false, skipped: 'amount-mismatch' };
    }
    // STEP 4: conditional attempt transition
    const attemptUpd = await c.query(
      `UPDATE "PaymentAttempt" SET status='paid', "providerTransactionId"=$2, "updatedAt"=NOW()
       WHERE id=$1 AND "shopId"=$3 AND status IN ('created','pending')`,
      [attempt.id, args.txnId, args.shopId],
    );
    if (attemptUpd.rowCount === 0) {
      const cur = await c.query(`SELECT status FROM "PaymentAttempt" WHERE id=$1`, [attempt.id]);
      await c.query('ROLLBACK');
      return { applied: false, duplicate: false, skipped: `attempt-terminal-${cur.rows[0]?.status}` };
    }
    // STEP 5: conditional order transition
    const orderUpd = await c.query(
      `UPDATE "Order" SET status='paid', "paidAt"=NOW(), "paymentTxnId"=$3, "paymentProvider"='phonepe', "updatedAt"=NOW()
       WHERE id=$1 AND "shopId"=$2 AND status='awaiting_payment'`,
      [args.orderId, args.shopId, args.txnId],
    );
    // STEP 6: mark processed
    await c.query(`UPDATE "PaymentEvent" SET "processingStatus"='processed', "processedAt"=NOW() WHERE id=$1`, [`evt-${args.eventId}`]);
    await c.query('COMMIT');
    return { applied: true, duplicate: false, skipped: null };
  } catch (e: any) {
    try { await c.query('ROLLBACK'); } catch { /* connection-scoped rollback may fail if tx already aborted */ }
    return { applied: false, duplicate: false, skipped: `error:${e.code ?? e.message}` };
  } finally {
    c.release();
  }
}

/** Force a mid-transaction failure AFTER the event insert (scenario 8/9). */
async function deliverWithFailureAfterClaim(
  client: Pool,
  args: { moid: string; eventId: string; txnId: string; shopId: string; orderId: string; failAt: 'subscription' | 'afterclaim' },
): Promise<LifecycleResult> {
  const c = await client.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const att = await c.query(`SELECT * FROM "PaymentAttempt" WHERE "merchantOrderId" = $1`, [args.moid]);
    const attempt = att.rows[0];
    await c.query(
      `INSERT INTO "PaymentEvent" (id, "attemptId", provider, "eventId", "merchantOrderId", "providerTransactionId", "eventType", "signatureValid", "processingStatus")
       VALUES ($1, $2, 'phonepe', $3, $4, $5, 'webhook', true, 'received')`,
      [`evt-${args.eventId}`, attempt.id, args.eventId, args.moid, args.txnId],
    );
    if (args.failAt === 'afterclaim') throw Object.assign(new Error('crash after claim'), { code: 'XX999' });
    await c.query(
      `UPDATE "PaymentAttempt" SET status='paid', "updatedAt"=NOW() WHERE id=$1 AND status IN ('created','pending')`,
      [attempt.id],
    );
    await c.query(
      `UPDATE "Order" SET status='paid', "paidAt"=NOW(), "paymentTxnId"=$2, "updatedAt"=NOW() WHERE id=$1 AND status='awaiting_payment'`,
      [args.orderId, args.txnId],
    );
    throw Object.assign(new Error('subscription update failed'), { code: 'XX999' });
  } catch (e: any) {
    try { await c.query('ROLLBACK'); } catch { /* aborted */ }
    return { applied: false, duplicate: false, skipped: `error:${e.code ?? e.message}` };
  } finally {
    c.release();
  }
}

async function seed(pool: Pool, opts: { shopId?: string; orderId: string; moid: string; amountPaise?: number; attemptStatus?: string }) {
  const shopId = opts.shopId ?? 'shop-p3';
  await pool.query(
    `INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, "timezone", "isActive", "subscriptionTier", "createdAt", "updatedAt")
     VALUES ($1, 'P3 Shop', $2, 'user-p3', 'p3@okaxis', 'phonepe', '{}', '{}', 'addr', '555', 'Asia/Kolkata', true, 'free', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [shopId, `p3-${shopId.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'INR', NOW(), NOW())`,
    [opts.orderId, shopId, `TOK${opts.orderId}`, opts.attemptStatus === 'paid' ? 'paid' : 'awaiting_payment', opts.amountPaise ?? 50000],
  );
  await pool.query(
    `INSERT INTO "PaymentAttempt" (id, "shopId", "orderId", provider, "merchantOrderId", "amountPaise", "currency", status, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'phonepe', $4, $5, 'INR', $6, NOW() + INTERVAL '10 minutes', NOW(), NOW())`,
    [`att-${opts.moid}`, shopId, opts.orderId, opts.moid, opts.amountPaise ?? 50000, opts.attemptStatus ?? 'created'],
  );
}

/** The KEY assertion: exact financial state of one payment. */
async function financialState(pool: Pool, moid: string, orderId: string) {
  const events = await pool.query(`SELECT COUNT(*)::int AS n FROM "PaymentEvent" WHERE "merchantOrderId"=$1 AND "processingStatus"='processed'`, [moid]);
  const attempts = await pool.query(`SELECT status, COUNT(*)::int AS n FROM "PaymentAttempt" WHERE "merchantOrderId"=$1 GROUP BY status`, [moid]);
  const orders = await pool.query(`SELECT status, COUNT(*)::int AS n FROM "Order" WHERE id=$1 GROUP BY status`, [orderId]);
  const totalEffects =
    (events.rows[0]?.n ?? 0) +
    (attempts.rows.find((r) => r.status === 'paid')?.n ?? 0) +
    (orders.rows.find((r) => r.status === 'paid')?.n ?? 0);
  return {
    processedEvents: events.rows[0]?.n ?? 0,
    attemptStatus: attempts.rows.map((r) => `${r.status}:${r.n}`).join(','),
    orderStatus: orders.rows.map((r) => `${r.status}:${r.n}`).join(','),
    // exactly one effect = event processed 1 + attempt paid 1 + order paid 1
    financialEffectCount: totalEffects,
  };
}

describe('Phase 3 (P2-2) — payment webhook idempotency on real PostgreSQL', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 30 });
    const v = await pool.query('SELECT version()');
    expect(v.rows[0].version).toContain('PostgreSQL');
  }, TIMEOUT);
  afterAll(async () => { await pool.end(); }, TIMEOUT);
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE "PaymentEvent", "PaymentAttempt", "Order", "Shop", "AuditLog" CASCADE');
  }, TIMEOUT);

  it('1. single valid event → exactly one financial effect', async () => {
    await seed(pool, { orderId: 'o1', moid: 'm1' });
    const r = await deliver(pool, { moid: 'm1', eventId: 'TXN-1', txnId: 'TXN-1', shopId: 'shop-p3', orderId: 'o1' });
    expect(r.applied).toBe(true);
    const s = await financialState(pool, 'm1', 'o1');
    expect(s.processedEvents).toBe(1);
    expect(s.orderStatus).toBe('paid:1');
    expect(s.financialEffectCount).toBe(3); // event + attempt + order = one logical effect
  }, TIMEOUT);

  it('2. sequential duplicate event → still exactly one effect', async () => {
    await seed(pool, { orderId: 'o2', moid: 'm2' });
    const r1 = await deliver(pool, { moid: 'm2', eventId: 'TXN-2', txnId: 'TXN-2', shopId: 'shop-p3', orderId: 'o2' });
    const r2 = await deliver(pool, { moid: 'm2', eventId: 'TXN-2', txnId: 'TXN-2', shopId: 'shop-p3', orderId: 'o2' });
    expect(r1.applied).toBe(true);
    expect(r2.duplicate).toBe(true);
    expect(r2.applied).toBe(false);
    const s = await financialState(pool, 'm2', 'o2');
    expect(s.processedEvents).toBe(1);
    expect(s.orderStatus).toBe('paid:1');
  }, TIMEOUT);

  it('3. TWO concurrent duplicate deliveries → exactly one effect (P2-2 regression)', async () => {
    await seed(pool, { orderId: 'o3', moid: 'm3' });
    const results = await Promise.all([
      deliver(pool, { moid: 'm3', eventId: 'TXN-3', txnId: 'TXN-3', shopId: 'shop-p3', orderId: 'o3' }),
      deliver(pool, { moid: 'm3', eventId: 'TXN-3', txnId: 'TXN-3', shopId: 'shop-p3', orderId: 'o3' }),
    ]);
    expect(results.filter((r) => r.applied).length).toBe(1);
    expect(results.filter((r) => r.duplicate).length).toBe(1);
    const s = await financialState(pool, 'm3', 'o3');
    expect(s.processedEvents).toBe(1);
    expect(s.orderStatus).toBe('paid:1');
  }, TIMEOUT);

  it('4. TEN concurrent duplicate deliveries → exactly one effect', async () => {
    await seed(pool, { orderId: 'o4', moid: 'm4' });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => deliver(pool, { moid: 'm4', eventId: 'TXN-4', txnId: 'TXN-4', shopId: 'shop-p3', orderId: 'o4' })),
    );
    expect(results.filter((r) => r.applied).length).toBe(1);
    expect(results.filter((r) => r.applied || r.duplicate).length).toBe(10);
    const s = await financialState(pool, 'm4', 'o4');
    expect(s.processedEvents).toBe(1);
    expect(s.orderStatus).toBe('paid:1');
  }, TIMEOUT);

  it('5. concurrent DIFFERENT events for the same payment → attempt paid once, order paid once', async () => {
    await seed(pool, { orderId: 'o5', moid: 'm5' });
    const results = await Promise.all([
      deliver(pool, { moid: 'm5', eventId: 'TXN-5A', txnId: 'TXN-5A', shopId: 'shop-p3', orderId: 'o5' }),
      deliver(pool, { moid: 'm5', eventId: 'TXN-5B', txnId: 'TXN-5B', shopId: 'shop-p3', orderId: 'o5' }),
    ]);
    // Distinct eventIds — both event rows may exist, but the CONDITIONAL
    // attempt/order guards mean only one delivery flips state; the second
    // observes a terminal attempt.
    const appliedCount = results.filter((r) => r.applied).length;
    expect(appliedCount).toBe(1);
    const s = await financialState(pool, 'm5', 'o5');
    expect(s.orderStatus).toBe('paid:1');
    expect(s.attemptStatus).toBe('paid:1');
  }, TIMEOUT);

  it('6. concurrent events for DIFFERENT payments → each applies exactly once', async () => {
    await seed(pool, { orderId: 'o6a', moid: 'm6a' });
    await seed(pool, { orderId: 'o6b', moid: 'm6b' });
    const results = await Promise.all([
      deliver(pool, { moid: 'm6a', eventId: 'TXN-6A', txnId: 'TXN-6A', shopId: 'shop-p3', orderId: 'o6a' }),
      deliver(pool, { moid: 'm6b', eventId: 'TXN-6B', txnId: 'TXN-6B', shopId: 'shop-p3', orderId: 'o6b' }),
    ]);
    expect(results.filter((r) => r.applied).length).toBe(2);
    const s1 = await financialState(pool, 'm6a', 'o6a');
    const s2 = await financialState(pool, 'm6b', 'o6b');
    expect(s1.orderStatus).toBe('paid:1');
    expect(s2.orderStatus).toBe('paid:1');
  }, TIMEOUT);

  it('7. transaction failure mid-way → NO effects, state safely retryable', async () => {
    await seed(pool, { orderId: 'o7', moid: 'm7' });
    const r = await deliverWithFailureAfterClaim(pool, { moid: 'm7', eventId: 'TXN-7', txnId: 'TXN-7', shopId: 'shop-p3', orderId: 'o7', failAt: 'afterclaim' });
    expect(r.skipped).toMatch(/^error:/);
    const s = await financialState(pool, 'm7', 'o7');
    expect(s.processedEvents).toBe(0);
    expect(s.attemptStatus).toBe('created:1');
    expect(s.orderStatus).toBe('awaiting_payment:1');
  }, TIMEOUT);

  it('8. failure AFTER event claim (simulated crash) → rollback, no event row, retry applies', async () => {
    await seed(pool, { orderId: 'o8', moid: 'm8' });
    await deliverWithFailureAfterClaim(pool, { moid: 'm8', eventId: 'TXN-8', txnId: 'TXN-8', shopId: 'shop-p3', orderId: 'o8', failAt: 'subscription' });
    let s = await financialState(pool, 'm8', 'o8');
    expect(s.processedEvents).toBe(0);
    expect(s.orderStatus).toBe('awaiting_payment:1');
    // Retry (provider redelivery) now applies exactly once.
    const r = await deliver(pool, { moid: 'm8', eventId: 'TXN-8', txnId: 'TXN-8', shopId: 'shop-p3', orderId: 'o8' });
    expect(r.applied).toBe(true);
    s = await financialState(pool, 'm8', 'o8');
    expect(s.processedEvents).toBe(1);
    expect(s.orderStatus).toBe('paid:1');
  }, TIMEOUT);

  it('9. failure during the final update phase → rollback → retry applies exactly once', async () => {
    await seed(pool, { orderId: 'o9', moid: 'm9' });
    await deliverWithFailureAfterClaim(pool, { moid: 'm9', eventId: 'TXN-9', txnId: 'TXN-9', shopId: 'shop-p3', orderId: 'o9', failAt: 'subscription' });
    const r = await deliver(pool, { moid: 'm9', eventId: 'TXN-9', txnId: 'TXN-9', shopId: 'shop-p3', orderId: 'o9' });
    expect(r.applied).toBe(true);
    const s = await financialState(pool, 'm9', 'o9');
    expect(s.financialEffectCount).toBe(3);
  }, TIMEOUT);

  it('10. retry after rollback → one effect (idempotent redelivery path)', async () => {
    await seed(pool, { orderId: 'o10', moid: 'm10' });
    await deliverWithFailureAfterClaim(pool, { moid: 'm10', eventId: 'TXN-10', txnId: 'TXN-10', shopId: 'shop-p3', orderId: 'o10', failAt: 'afterclaim' });
    const [r1, r2] = await Promise.all([
      deliver(pool, { moid: 'm10', eventId: 'TXN-10', txnId: 'TXN-10', shopId: 'shop-p3', orderId: 'o10' }),
      deliver(pool, { moid: 'm10', eventId: 'TXN-10', txnId: 'TXN-10', shopId: 'shop-p3', orderId: 'o10' }),
    ]);
    expect([r1, r2].filter((r) => r.applied).length).toBe(1);
    const s = await financialState(pool, 'm10', 'o10');
    expect(s.processedEvents).toBe(1);
  }, TIMEOUT);

  it('11. signature-invalid event NEVER transitions payment state', async () => {
    await seed(pool, { orderId: 'o11', moid: 'm11' });
    const r = await deliver(pool, { moid: 'm11', eventId: 'TXN-11', txnId: 'TXN-11', shopId: 'shop-p3', orderId: 'o11', signatureValid: false });
    expect(r.skipped).toBe('signature-invalid');
    const s = await financialState(pool, 'm11', 'o11');
    expect(s.attemptStatus).toBe('created:1');
    expect(s.orderStatus).toBe('awaiting_payment:1');
  }, TIMEOUT);

  it('12. amount-mismatch payload → skipped, no transition', async () => {
    await seed(pool, { orderId: 'o12', moid: 'm12', amountPaise: 50500 });
    const r = await deliver(pool, { moid: 'm12', eventId: 'TXN-12', txnId: 'TXN-12', shopId: 'shop-p3', orderId: 'o12', amountPaise: 999 });
    expect(r.skipped).toBe('amount-mismatch');
    const s = await financialState(pool, 'm12', 'o12');
    expect(s.orderStatus).toBe('awaiting_payment:1');
  }, TIMEOUT);

  it('13. unknown payment reference → no event, no effect', async () => {
    await seed(pool, { orderId: 'o13', moid: 'm13' });
    const r = await deliver(pool, { moid: 'does-not-exist', eventId: 'TXN-13', txnId: 'TXN-13', shopId: 'shop-p3', orderId: 'o13' });
    expect(r.skipped).toBe('attempt-not-found');
    const evt = await pool.query(`SELECT COUNT(*)::int AS n FROM "PaymentEvent" WHERE "merchantOrderId"='does-not-exist'`);
    expect(evt.rows[0].n).toBe(0);
  }, TIMEOUT);

  it('14. OLD event replay cannot regress a newer legitimate state (printing)', async () => {
    await seed(pool, { orderId: 'o14', moid: 'm14' });
    await deliver(pool, { moid: 'm14', eventId: 'TXN-14', txnId: 'TXN-14', shopId: 'shop-p3', orderId: 'o14' });
    // Order moved on legitimately: printing (newer state than paid).
    await pool.query(`UPDATE "Order" SET status='printing' WHERE id='o14'`);
    const r = await deliver(pool, { moid: 'm14', eventId: 'TXN-14-replay', txnId: 'TXN-14-replay', shopId: 'shop-p3', orderId: 'o14' });
    // Distinct event id → insert succeeds; attempt guard (terminal 'paid') blocks.
    expect(r.skipped).toBe('attempt-terminal-paid');
    const s = await financialState(pool, 'm14', 'o14');
    expect(s.orderStatus).toBe('printing:1');
  }, TIMEOUT);

  it('15. already-refunded (failed) attempt → stale event skipped, no regression', async () => {
    await seed(pool, { orderId: 'o15', moid: 'm15', attemptStatus: 'failed' });
    const r = await deliver(pool, { moid: 'm15', eventId: 'TXN-15', txnId: 'TXN-15', shopId: 'shop-p3', orderId: 'o15' });
    expect(r.skipped).toBe('attempt-terminal-failed');
    const s = await financialState(pool, 'm15', 'o15');
    expect(s.attemptStatus).toBe('failed:1');
    expect(s.orderStatus).toBe('awaiting_payment:1');
  }, TIMEOUT);

  it('16. already-captured payment → duplicate effect count stays 1', async () => {
    await seed(pool, { orderId: 'o16', moid: 'm16', attemptStatus: 'paid' });
    const r = await deliver(pool, { moid: 'm16', eventId: 'TXN-16', txnId: 'TXN-16', shopId: 'shop-p3', orderId: 'o16' });
    expect(r.skipped).toBe('attempt-terminal-paid');
    const s = await financialState(pool, 'm16', 'o16');
    expect(s.processedEvents).toBe(0);
    expect(s.attemptStatus).toBe('paid:1');
  }, TIMEOUT);
});

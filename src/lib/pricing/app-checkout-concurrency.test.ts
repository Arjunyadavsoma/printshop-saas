/**
 * Phase 6.9 — Checkout concurrency test (P0)
 *
 * Tests the ACTUAL checkout API route handler (`POST /api/v1/orders/:id/checkout`)
 * against real PostgreSQL 17.11 with independent TCP connections.
 *
 * ## What this test does NOT do
 *
 * It does NOT mock `@/lib/db` — the real Prisma client is used. The
 * container is constructed lazily by `getContainer()` with
 * `DATABASE_PROVIDER=prisma`, so the PrismaDatabaseAdapter delegates to
 * `prisma.paymentAttempt`, `prisma.order`, `prisma.shop`, `prisma.printFile`,
 * `prisma.auditLog` — all connected to the same PostgreSQL test database via
 * `DATABASE_URL`.
 *
 * ## Test scenario
 *
 *   1. Seed a Shop + Order with a PrintFile (with a non-zero pricePaise +
 *      order.totalAmountPaise set, so the checkout route's preconditions pass).
 *   2. Construct 20 `NextRequest` objects for POST
 *      `/api/v1/orders/{id}/checkout`, each carrying the order's
 *      `customerToken` via the `X-Order-Token` header.
 *   3. Fire them simultaneously via `Promise.allSettled`.
 *   4. Verify:
 *      - Exactly 1 PaymentAttempt with status='created' exists for the order
 *        (enforced by the partial unique index
 *        `PaymentAttempt_active_order_unique ON (orderId) WHERE status='created'`).
 *      - All 20 responses return HTTP 200 (no 500 errors). The checkout
 *        route's idempotency logic (findFirst → reuse OR INSERT with P2002
 *        catch → reuse winner's merchantOrderId) ensures every concurrent
 *        request resolves to the same active attempt.
 *      - All 20 responses reference the SAME merchantOrderId (the winner's).
 *
 * ## Env var ordering
 *
 * Same as `app-webhook-integration.test.ts`: `DATABASE_URL` is set at the
 * top of the file BEFORE any dynamic import of `@/lib/db` (which constructs
 * the PrismaClient).
 */

// ── Env vars MUST be set before any dynamic import of @/lib/* ──────────
process.env.DATABASE_URL = 'postgresql://z@127.0.0.1:5433/printshop_app_test';
process.env.DATABASE_PROVIDER = 'prisma';
(process.env as { NODE_ENV?: string }).NODE_ENV = 'test';
process.env.REALTIME_PROVIDER = 'memory';
process.env.CACHE_PROVIDER = 'memory';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-chars-long';

import { describe, expect, it, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

const DB_URL = 'postgresql://z@127.0.0.1:5433/printshop_app_test';
const TIMEOUT = 30_000;

// ── Lazy-loaded checkout route (loaded AFTER env vars are set) ─────────
let POST: typeof import('@/app/api/v1/orders/[id]/checkout/route').POST;

// ── Test DB pool (independent of Prisma — used for seed + verify) ──────
let pool: Pool;

/** Wipe the payment-related tables (FK-aware, CASCADE). */
async function cleanAll(): Promise<void> {
  await pool.query(
    `TRUNCATE TABLE "PaymentEvent", "PaymentAttempt", "Order", "Shop" CASCADE`,
  );
}

/**
 * Seed a Shop + Order + PrintFile for the checkout test.
 *
 * The checkout route requires:
 *   - Order in status='awaiting_payment'
 *   - Shop with upiId
 *   - At least one PrintFile with pricePaise > 0
 *   - order.totalAmountPaise > 0 (set via UPDATE — the route reads it
 *     exclusively from the persisted total, never from the request body)
 */
async function seedCheckoutFixture(): Promise<{
  shopId: string;
  orderId: string;
  customerToken: string;
}> {
  const shopId = 'shop-p69-cc';
  const orderId = 'order-p69-cc';
  const customerToken = 'TOKP69CC';
  const fileId = 'file-p69-cc';
  const AMOUNT = 50000;

  // Shop with provider='googlepay' (the UPI deep-link adapter — no external
  // API calls, returns a upi:// URI synchronously).
  await pool.query(
    `INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, "timezone", "isActive", "subscriptionTier", "createdAt", "updatedAt")
     VALUES ($1, 'Phase 6.9 CC Shop', 'phase69-cc-shop', 'user-p69-cc', 'p69cc@okaxis', 'googlepay', '{}', '{}', 'addr', '555', 'Asia/Kolkata', true, 'free', NOW(), NOW())`,
    [shopId],
  );
  await pool.query(
    `INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'awaiting_payment', $4, 'INR', NOW(), NOW())`,
    [orderId, shopId, customerToken, AMOUNT],
  );
  // PrintFile with a non-zero pricePaise (so the checkout route's
  // "unpaid files" guard passes).
  await pool.query(
    `INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType", "sizeBytes", "pageCount", copies, "colorMode", "paperSize", duplex, "pricePaise", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'test.pdf', 'shops/${shopId}/orders/${orderId}/${fileId}', 'application/pdf', 1024, 5, 1, 'bw', 'a4', false, $3, 'pending', NOW(), NOW())`,
    [fileId, orderId, AMOUNT],
  );

  return { shopId, orderId, customerToken };
}

// ─── Test lifecycle ───────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Open the raw pg pool.
  pool = new Pool({ connectionString: DB_URL, max: 25 });
  const r = await pool.query('SELECT version()');
  expect(r.rows[0].version).toContain('PostgreSQL');

  // 2. Verify the partial unique index that enforces "at most one 'created'
  //    PaymentAttempt per order" exists.
  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE indexname = 'PaymentAttempt_active_order_unique'`,
  );
  expect(idx.rowCount).toBeGreaterThan(0);

  // 3. Load the checkout route handler AFTER env vars are set.
  const mod = await import('@/app/api/v1/orders/[id]/checkout/route');
  POST = mod.POST;
}, TIMEOUT);

afterAll(async () => {
  if (pool) await pool.end();
}, TIMEOUT);

beforeEach(async () => {
  await cleanAll();
}, TIMEOUT);

afterEach(async () => {
  // Clean up after each test so the next test file (e.g. webhook-postgres-fk.test.ts)
  // doesn't inherit leftover PrintFile rows that would block its DELETE FROM "Order".
  await cleanAll();
}, TIMEOUT);

// ─── The test ─────────────────────────────────────────────────────────

describe('Phase 6.9 — checkout concurrency against real PostgreSQL', () => {
  it(
    '20 simultaneous checkout requests → exactly 1 PaymentAttempt, all 200, same merchantOrderId',
    async () => {
      const { orderId, customerToken } = await seedCheckoutFixture();

      // Construct 20 NextRequest objects for POST /api/v1/orders/:id/checkout.
      // Each carries the order's customerToken via the X-Order-Token header
      // (required by withOrderAccess).
      const requests = Array.from({ length: 20 }, () => {
        const req = new NextRequest(
          `http://localhost:3000/api/v1/orders/${orderId}/checkout`,
          {
            method: 'POST',
            headers: {
              'x-order-token': customerToken,
              // Vary the X-Forwarded-For so the rate limiter (keyed by IP)
              // doesn't reject the 20 concurrent requests (limit=20/60s).
            },
          },
        );
        // Patch the XFF so each request comes from a "different" IP — bypasses
        // the per-IP rate limit (20/60s would otherwise reject the 21st
        // request; we send 20, but with a single IP the limiter's counter
        // increments on every call so the 20th is exactly at the limit).
        // Using 20 distinct IPs gives each its own counter — no rate-limit
        // interference with the concurrency test.
        req.headers.set('x-forwarded-for', `10.0.0.${Math.floor(Math.random() * 250) + 1}`);
        return req;
      });

      // Fire all 20 simultaneously via Promise.allSettled. Each invocation of
      // POST runs in its own micro-task; they all share the same Prisma
      // client (which uses a connection pool) + the same PostgreSQL test DB.
      const results = await Promise.allSettled(
        requests.map((req) =>
          POST(req, { params: Promise.resolve({ id: orderId }) }),
        ),
      );

      // Parse every response's JSON body (regardless of fulfill/reject —
      // a rejected promise means the route threw, which we treat as a 500).
      const parsed = await Promise.all(
        results.map(async (r, i) => {
          if (r.status === 'rejected') {
            return {
              status: 500,
              ok: false,
              merchantOrderId: null,
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
              index: i,
            };
          }
          const res = r.value;
          let body: { success?: boolean; data?: { merchantOrderId?: string }; error?: unknown } = {};
          try {
            body = await res.json();
          } catch {
            // Non-JSON response — treat as a failure.
          }
          return {
            status: res.status,
            ok: body.success === true,
            merchantOrderId: body.data?.merchantOrderId ?? null,
            error: body.success === false ? JSON.stringify(body.error) : null,
            index: i,
          };
        }),
      );

      // 1. All 20 responses return HTTP 200 (no 500 errors).
      const statuses = parsed.map((p) => p.status);
      const nonOk = parsed.filter((p) => p.status !== 200);
      if (nonOk.length > 0) {
        // Surface the first failure for debugging.
        const first = nonOk[0];
        expect.fail(
          `Expected all 20 responses to be HTTP 200, but got ${nonOk.length} non-OK. ` +
            `First failure: status=${first.status}, error=${first.error ?? 'n/a'}. ` +
            `All statuses: ${JSON.stringify(statuses)}`,
        );
      }
      expect(parsed.every((p) => p.status === 200)).toBe(true);

      // 2. All 20 responses are success=true (envelope).
      const allOk = parsed.every((p) => p.ok);
      expect(allOk).toBe(true);

      // 3. All 20 responses reference the SAME merchantOrderId (the winner's).
      const merchantOrderIds = new Set(
        parsed.map((p) => p.merchantOrderId).filter((m): m is string => m !== null),
      );
      expect(merchantOrderIds.size).toBe(1);
      const moid = parsed[0]!.merchantOrderId;
      expect(moid).toBeTruthy();
      // The merchantOrderId is derived from the order id (`checkout-${order.id}`)
      // — the stable idempotency key introduced in Phase 6.3.
      expect(moid).toBe(`checkout-${orderId}`);

      // 4. Exactly 1 PaymentAttempt with status='created' exists for the order
      //    in the PostgreSQL database (verified via the independent pg pool —
      //    proves the SQL landed, not just that Prisma returned the right
      //    objects).
      const attCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = 'created'`,
        [orderId],
      );
      expect(attCount.rows[0].count).toBe(1);

      // 5. No 'paid'/'failed'/'expired' attempts were created (no side-effects).
      const otherAttempts = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "PaymentAttempt" WHERE "orderId" = $1 AND status != 'created'`,
        [orderId],
      );
      expect(otherAttempts.rows[0].count).toBe(0);

      // 6. The single PaymentAttempt has the correct amountPaise (from the
      //    order's totalAmountPaise, NOT from any client-supplied value).
      const att = await pool.query(
        `SELECT "amountPaise", "merchantOrderId", "idempotencyKey", "expiresAt" FROM "PaymentAttempt" WHERE "orderId" = $1 AND status = 'created'`,
        [orderId],
      );
      expect(att.rowCount).toBe(1);
      expect(att.rows[0].amountPaise).toBe(50000);
      expect(att.rows[0].merchantOrderId).toBe(moid);
      expect(att.rows[0].idempotencyKey).toBe(`checkout-${orderId}`);
      expect(att.rows[0].expiresAt).toBeInstanceOf(Date);

      // 7. The order is still in 'awaiting_payment' (checkout does NOT
      //    transition the order — the webhook does that).
      const ord = await pool.query(`SELECT status FROM "Order" WHERE id = $1`, [orderId]);
      expect(ord.rows[0].status).toBe('awaiting_payment');

      // 8. At least one audit log entry was written (best-effort — the audit
      //    repo swallows errors). This proves the checkout route's audit
      //    hook ran end-to-end against the real DB.
      const auditCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "AuditLog" WHERE action = 'order.checkout' AND "entityId" = $1`,
        [orderId],
      );
      expect(auditCount.rows[0].count).toBeGreaterThanOrEqual(1);
    },
    TIMEOUT,
  );
});

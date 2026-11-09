# Payment Reconciliation Service

**Branch:** `phase-5-3-payment-lifecycle-reconciliation`
**Date:** 2025-11-09
**Status:** Reference document — reconciliation cron route design

---

## Purpose

This document describes the reconciliation cron route at
`src/app/api/v1/cron/reconcile-payments/route.ts` — its scheduling mechanism,
authentication model, batch limits, retry behavior, failure handling,
operational monitoring, and limitations.

The reconciliation service is the **safety net** for the payment pipeline. It
catches payments that succeeded at the provider but failed to be recorded at
PrintShop SaaS (e.g., webhook delivery failure, webhook signature mismatch,
server cold-start during webhook delivery, transient DB error during the
lifecycle transition). Without it, a customer who paid but whose webhook was
lost would have an order stuck in `awaiting_payment` forever.

---

## Scheduling mechanism

The endpoint is invoked by **Vercel Cron** (configured in `vercel.json`):

```jsonc
{
  "crons": [
    {
      "path": "/api/v1/cron/reconcile-payments",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

- **Endpoint:** `GET /api/v1/cron/reconcile-payments`
- **Schedule:** every 10 minutes (configurable — change the `schedule` field
  in `vercel.json` and redeploy).
- **Region:** `bom1` (Mumbai) — matches the rest of the deployment (see
  `vercel.json` `regions`).

Vercel Cron automatically sends an `Authorization: Bearer ${CRON_SECRET}`
header on every invocation. The route validates this header (see
"Authentication" below).

> **Note:** The `vercel.json` `crons` array should be added when deploying
> this branch. The route itself is fully functional and can also be invoked
> manually (with the correct secret) for testing or ad-hoc reconciliation.

---

## Authentication

The route uses a **shared-secret** authentication model — same pattern as the
existing `cleanup` cron route.

| Source | Env var | Fallback |
|--------|---------|----------|
| `Authorization: Bearer <secret>` header | `CRON_SECRET` | `SETUP_KEY` |
| `?secret=<secret>` query parameter | `CRON_SECRET` | `SETUP_KEY` |

```ts
const authHeader = req.headers.get('authorization') ?? '';
const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
const querySecret = new URL(req.url).searchParams.get('secret') ?? '';
const expectedSecret = process.env.CRON_SECRET ?? process.env.SETUP_KEY ?? '';

// Fail CLOSED: if CRON_SECRET is unset OR the token doesn't match → 401.
if (!expectedSecret || (token !== expectedSecret && querySecret !== expectedSecret)) {
  return Response.json(
    { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid cron secret' } },
    { status: 401 },
  );
}
```

**Fail-closed semantics:**

- If `CRON_SECRET` is **unset** AND `SETUP_KEY` is **unset** → 401. The route
  refuses to run without authentication configured. This prevents an
  accidentally-deployed route from being abused by unauthenticated callers.
- If `CRON_SECRET` is set but the token doesn't match → 401.
- If `CRON_SECRET` is set and the token matches → 200 (continue).

Vercel Cron automatically sends the `Authorization: Bearer ${CRON_SECRET}`
header — no manual configuration is needed beyond setting the env var. The
`?secret=` query parameter fallback is for manual invocation (e.g., curl
during operational troubleshooting).

---

## Batch limits

| Parameter | Default | Configurable via | Hard cap |
|-----------|---------|-------------------|----------|
| Attempts per invocation | 10 | `?limit=` query param | 50 |

```ts
const MAX_BATCH = 10;
const limitParam = parseInt(new URL(req.url).searchParams.get('limit') ?? String(MAX_BATCH), 10);
const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : MAX_BATCH, 50);
```

The hard cap of 50 prevents a single cron invocation from spiraling into a
multi-minute job that would overlap with the next cron tick. With a 10-minute
schedule and a 15-second per-attempt timeout, the worst-case batch runtime is
`50 × 15s = 750s = 12.5 min` — slightly over one schedule interval, but the
operation is idempotent (see below), so an overlapping invocation is safe.

The `findStalePaymentAttempts(staleAfterMs, limit)` helper in
`lifecycle.service.ts` ALSO enforces the 50-row hard cap:

```ts
take: Math.min(limit, 50), // hard cap at 50
```

This is a defense-in-depth measure — even if a caller passes `?limit=10000`,
the DB query itself is bounded.

---

## Stale detection

### PaymentAttempt staleness

An attempt is "stale" if:
- `status = 'created'` (never transitioned to paid/failed/expired)
- `createdAt < NOW() - 10 minutes` (the payment window has elapsed)

The 10-minute threshold (`STALE_THRESHOLD_MS = 10 * 60 * 1000`) matches the
typical UPI/PSP payment window. A `created` attempt older than 10 minutes
almost certainly means the webhook was lost or delayed — UPI payments
complete in under 30 seconds when they succeed.

`findStalePaymentAttempts(10min, limit)` queries:

```ts
db.paymentAttempt.findMany({
  where: {
    status: 'created',
    createdAt: { lt: cutoff },
  },
  orderBy: { createdAt: 'asc' }, // oldest first — most urgent
  take: Math.min(limit, 50),
});
```

### PaymentEvent staleness (for future use)

Stale `PaymentEvent` rows (events that were `received` but never
`processed` / `skipped` / `failed`) are detected by:

```sql
SELECT * FROM "PaymentEvent"
WHERE "processingStatus" = 'received'
  AND "receivedAt" < NOW() - INTERVAL '5 minutes';
```

A `received` event older than 5 minutes indicates the lifecycle transaction
started but never completed (e.g., the serverless function was killed
mid-transaction by Vercel's timeout). The reconciliation cron does NOT
currently reprocess these events — the `PaymentEvent` row is informational
(forensic) and the underlying `PaymentAttempt` is reconciled via the
status-poll path described below. This is a documented limitation (see
"Limitations").

---

## Retry behavior

Each attempt has a **15-second timeout** (via `Promise.race`):

```ts
const VERIFY_TIMEOUT_MS = 15_000;

verification = await Promise.race([
  adapter.verifyPayment({
    merchantOrderId: attempt.merchantOrderId,
    shopCredentials: shop.paymentCredentials,
  }),
  timeoutAfter(VERIFY_TIMEOUT_MS),
]);
```

If `verifyPayment` times out (or throws any other error — network, DNS,
TLS, provider 5xx), the attempt is recorded as `outcome='verify_error'` and
**left pending** (status stays `created`) for the next cron cycle:

```ts
} catch (e) {
  detail.outcome = 'verify_error';
  stats.errors++;
  stats.details.push(detail);
  await safeAudit(attempt, 'verify_error', e instanceof Error ? e.message : 'verify threw');
  continue; // ← the cron moves on to the next attempt
}
```

**The operation is idempotent — safe under retries and overlapping
invocations:**

- The `PaymentEvent` UNIQUE([provider, eventId]) constraint catches a
  duplicate event insert (e.g., two overlapping cron ticks both verify the
  same attempt and both call `applyPaymentTransition`).
- The `PaymentAttempt` conditional UPDATE (WHERE status IN ('created',
  'pending')) catches the case where one tick transitioned the attempt to
  `paid` and the second tick's `applyPaymentTransition` call tries to
  re-transition it.
- The `Order` conditional UPDATE (WHERE status='awaiting_payment') catches
  the case where the webhook already transitioned the order between the two
  cron ticks.

See `PAYMENT_LIFECYCLE.md` "Idempotency guarantees" for the full layered
dedup design.

---

## Failure handling

For each stale attempt, the cron calls `adapter.verifyPayment()` and branches
on the result:

| Outcome | Condition | Action |
|---------|-----------|--------|
| `paid` | `verification.paid === true` AND `verification.amountPaise === attempt.amountPaise` | Calls `applyPaymentTransition({ paid: true, ... })` — atomically transitions the attempt → `paid` and the order → `paid`. Audit-logs `reconciliation.attempt` with `outcome='paid'`. |
| `amount_mismatch` | `verification.paid === true` AND `verification.amountPaise !== attempt.amountPaise` | Leaves the attempt pending (`status='created'`). Audit-logs `reconciliation.attempt` with `outcome='amount_mismatch'`. Flagged for manual review. |
| `not_paid` | `verification.paid === false` | Leaves the attempt pending. Audit-logs with `outcome='not_paid'`. The customer may still complete the payment (or retry checkout with a new attempt). |
| `verify_error` | `verifyPayment` threw OR timed out | Leaves the attempt pending. Audit-logs with `outcome='verify_error'`. The next cron tick will retry. |
| `shop_missing` | `repos.shops.findById(attempt.shopId)` returned null | Skipped. Audit-logs with `outcome='shop_missing'`. |
| `adapter_missing` | No adapter registered for the attempt's provider | Skipped. Audit-logs with `outcome='adapter_missing'`. |
| `transition_failed` | `verifyPayment` succeeded but `applyPaymentTransition` threw | Leaves the attempt pending. Audit-logs with `outcome='transition_failed'`. The next cron tick will retry. |

**Provider outages don't corrupt payment state.** If the provider's status
API is down (5xx, timeout, DNS failure), every affected attempt is recorded
as `verify_error` and left in `created` status. When the provider recovers,
the next cron tick will successfully verify + transition. No payment is
marked `paid` without a confirmed provider response.

**One failure does NOT abort the batch.** Each attempt is wrapped in its own
try/catch. A single `verifyPayment` failure (or `applyPaymentTransition`
failure, or shop lookup failure) is logged + audited, and the cron continues
with the next attempt in the batch.

---

## Operational monitoring

### Audit log

Every reconciliation attempt produces an `audit_logs` row:

```ts
await repos.audit.log({
  shopId: attempt.shopId,
  userId: null,
  action: 'reconciliation.attempt',
  entityType: 'payment',
  entityId: attempt.id,
  metadata: {
    provider: attempt.provider,
    outcome,           // 'paid' | 'amount_mismatch' | 'not_paid' | ...
    reason,            // human-readable detail
    attemptId: attempt.id,
  },
  ip: null,
});
```

The audit log is written via `safeAudit()` — a best-effort wrapper that
catches + swallows any audit-write failure. Audit logging must never break
the reconciliation flow.

**The audit metadata records ONLY `{ provider, outcome, reason, attemptId }`**.
It never logs credentials, merchantKey, saltKey, auth headers, or raw webhook
bodies. This is a security requirement — the audit log is queryable by
shopkeepers + admins, and payment credentials must never appear in it.

### Response JSON

The cron response is a JSON envelope:

```jsonc
{
  "success": true,
  "data": {
    "processed": 10,       // total attempts examined
    "paid": 3,             // successfully transitioned to paid
    "skipped": 5,          // not_paid / amount_mismatch / shop_missing / adapter_missing
    "errors": 2,           // verify_error / transition_failed
    "details": [
      { "attemptId": "...", "provider": "phonepe", "outcome": "paid" },
      { "attemptId": "...", "provider": "paytm",   "outcome": "verify_error" },
      ...
    ],
    "timestamp": "2025-11-09T..."
  }
}
```

The `details` array has one entry per attempt examined, with the per-attempt
outcome. This is useful for operational dashboards + for ad-hoc
troubleshooting via curl.

### Stale detection queries

| Detection | Query | Location |
|-----------|-------|----------|
| Stale `PaymentAttempt` | `status='created' AND createdAt < NOW() - 10min` | `findStalePaymentAttempts` in `lifecycle.service.ts` |
| Stale `PaymentEvent` | `processingStatus='received' AND receivedAt < NOW() - 5min` | See "Stale detection" above (not currently reprocessed by the cron) |

---

## Limitations

1. **Does not automatically expire very old attempts.** A `PaymentAttempt`
   that's been in `created` status for hours (or days) will be polled every
   cron tick until either (a) the provider confirms paid, (b) the provider
   confirms not-paid (left pending for manual review), or (c) an operator
   manually calls `expirePaymentAttempt(attemptId, reason)`. The cron does
   NOT auto-expire old attempts because:
   - UPI payments can sometimes be delayed by hours (rare but documented).
   - Auto-expiring a paid-but-delayed payment would lose revenue.
   - Manual review of old attempts is safer than automatic expiry.
   The `expirePaymentAttempt` function IS exported from
   `lifecycle.service.ts` for use by operational scripts.

2. **Does not handle refunds.** The cron only confirms payments
   (`applyPaymentTransition({ paid: true })`). Refunds are a separate
   financial operation — initiated by the shopkeeper via the adapter's
   `refund()` method, recorded as a separate `PaymentEvent` (eventType
   `'refund'`), and not reconciled by this cron. Refund reconciliation is
   left for a future phase.

3. **Provider status API reliability is not guaranteed.** The cron depends
   on the provider's status API (`/v3/order/status` for Paytm, the v2
   observation API for PhonePe). If a provider's status API is down, the
   cron records `verify_error` for every affected attempt and retries on
   the next tick — but it cannot transition payments without provider
   confirmation. This is documented in
   `WEBHOOK_LIFECYCLE_AND_RECONCILIATION.md` along with the provider
   retry behavior assumptions.

4. **No exponential backoff on repeated `verify_error`.** An attempt that
   fails verification on tick N will be retried on tick N+1 (10 minutes
   later), then N+2, N+3, etc. There's no "after K failures, stop
   retrying" logic. For a healthy provider, this is fine (transient
   failures resolve within 1–2 ticks). For a sustained provider outage,
   the cron will keep polling every 10 minutes — which is the desired
   behavior (when the provider recovers, the cron immediately picks up
   the pending attempts). The cost is a small number of wasted status-API
   calls during an outage, which providers tolerate.

5. **The cron does not reprocess stale `PaymentEvent` rows** (events stuck
   in `received` status). Those events are informational — the underlying
   `PaymentAttempt` is reconciled via the status-poll path. A future
   enhancement could add a "stale event reprocessor" that re-invokes
   `applyPaymentTransition` for events stuck in `received` for > 5 minutes,
   but the current design relies on the status-poll path to converge the
   state.

---

## See also

- `src/app/api/v1/cron/reconcile-payments/route.ts` — the implementation.
- `src/app/api/v1/cron/reconcile-payments/route.test.ts` — behavioral tests
  (authentication, batch limits, per-attempt failure isolation, idempotency).
- `src/lib/payments/lifecycle.service.ts` — `findStalePaymentAttempts` +
  `applyPaymentTransition` + `expirePaymentAttempt`.
- `docs/payments/PAYMENT_LIFECYCLE.md` — the atomic lifecycle service that
  the cron delegates to.
- `docs/payments/WEBHOOK_LIFECYCLE_AND_RECONCILIATION.md` — provider webhook
  retry behavior + defensive measures.
- `vercel.json` — Vercel Cron schedule configuration.

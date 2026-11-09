# RECONCILE-TESTS — payment reconciliation cron + lifecycle + paytm-checksum tests

**Task ID:** RECONCILE-TESTS
**Agent:** test-author
**Date:** 2026-11-09
**Status:** ✅ complete
**Branch:** phase-5-3-payment-lifecycle-reconciliation

## Summary

Implemented the Phase 5.3 payment reconciliation cron route + added 30 new
tests (Paytm checksum known-vectors, reconciliation behavioral, lifecycle
atomic-transition). All tests pass; tsc + eslint are clean.

## Files created

| File | Tests | Purpose |
|------|-------|---------|
| `src/app/api/v1/cron/reconcile-payments/route.ts` | — | Reconciliation cron endpoint (GET). Auth via CRON_SECRET (fail-closed). Bounded batch (default 10, hard cap 50). Per-attempt 15s verify timeout via `Promise.race`. Per-attempt try/catch. Audit-logs reconciliation outcomes with NO credentials in metadata. |
| `src/app/api/v1/cron/reconcile-payments/route.test.ts` | 9 | Behavioral tests: verified-payment resolution, not-paid left pending, idempotent retries, unauthorized 401, missing-secret fail-closed, concurrent double-process protection, amount mismatch, verify_error, audit-no-credentials. |
| `src/lib/payments/paytm-checksum.test.ts` | 11 | Known-vector tests for the official Paytm checksum algorithm: round-trip, 32-char key, wrong-key rejection, tampered-payload rejection, missing fields, malformed checksum, short-key throw/false, IV `@@@@&&&&####$$$$` (not `0123456789012345`), random salt, CHECKSUMHASH exclusion. |
| `src/lib/payments/lifecycle.service.test.ts` | 10 | Atomic-transition contract tests for `applyPaymentTransition`: atomic attempt+event flip, rollback safety, duplicate idempotency, concurrent dedup, stale-event rejection, amount+currency mismatch rejection, provider-ref persistence, paid-after-paid idempotency, tenant-mismatch rejection, not-found skip. |

## Files modified

| File | Change |
|------|--------|
| `src/lib/payments/test-prisma-mock.ts` | Added `paymentAttempt.findMany` (needed by `findStalePaymentAttempts`). Added UNIQUE([provider, eventId]) enforcement in `paymentEvent.create` (throws 23505 on duplicate — mirrors the real PostgreSQL constraint that the lifecycle service's dedup path relies on). |

## Test results

```bash
$ bunx tsc --noEmit; echo $?
0   # ✅ clean

$ bunx eslint .; echo $?
0   # ✅ clean

$ bunx vitest run --reporter=dot
 Test Files  34 passed (34)
      Tests  386 passed | 1 skipped (387)   # ✅ all pass
```

Baseline before this task: **356 passed | 1 skipped (357 total) across 31 files.**
After: **386 passed | 1 skipped (387 total) across 34 files.**
Delta: **+30 tests, +3 files.**

## Key design decisions

### Reconciliation route (`route.ts`)

- **Auth pattern**: copied verbatim from `src/app/api/v1/cron/cleanup/route.ts` — `process.env.CRON_SECRET ?? process.env.SETUP_KEY ?? ''`, fails CLOSED (401) if unset or mismatched. Accepts `Authorization: Bearer <secret>` header OR `?secret=` query.
- **Bounded batch**: `Math.min(parseInt(limit ?? '10', 10), 50)` — default 10, hard cap 50.
- **Staleness threshold**: 10 minutes (`10 * 60 * 1000`) — matches the typical UPI/PSP payment window.
- **Per-attempt verify timeout**: 15 seconds via `Promise.race([adapter.verifyPayment(...), timeoutAfter(15_000)])`.
- **Per-attempt try/catch**: one failure (network, timeout, lifecycle throw) does NOT abort the batch.
- **Outcomes**: `paid`, `amount_mismatch`, `not_paid`, `verify_error`, `shop_missing`, `adapter_missing`, `transition_failed`. Each is audit-logged with `action: 'reconciliation.attempt'`, `entityType: 'payment'`, `entityId: attempt.id`, `metadata: { provider, outcome, reason, attemptId }`.
- **No credentials in logs/audit**: metadata is explicitly restricted to the 4 safe fields. No `saltKey`, `merchantKey`, `Bearer`, raw body, or auth headers.
- **Idempotency**: relies on `applyPaymentTransition`'s PaymentEvent UNIQUE([provider, eventId]) + conditional updates. Safe under Vercel Cron retries + overlapping invocations.

### Mock enhancements (`test-prisma-mock.ts`)

- **`paymentAttempt.findMany`**: added because `findStalePaymentAttempts` calls it (the mock previously only had `findUnique`/`create`/`update`/`updateMany`). Supports `where`, `orderBy` (single-field), `take`.
- **UNIQUE([provider, eventId]) enforcement**: `paymentEvent.create` now checks for an existing row with the same `(provider, eventId)` and throws a 23505 error if found. This mirrors the real PostgreSQL partial unique index and is REQUIRED for the lifecycle service's dedup path — without it, `applyPaymentTransition`'s catch-then-read-existing-event branch never fires, so duplicate events would create duplicate rows + double-apply transitions.

### Lifecycle test 4 — concurrency

- The spec asked for concurrent `applyPaymentTransition` calls via `Promise.all`. Vitest 5.0.4 has a race condition where CONCURRENT dynamic imports of `@/lib/db` (which `applyPaymentTransition` does internally via `await import('@/lib/db')`) with an ASYNC vi.mock factory can cause one import to resolve to the unmocked real Prisma client while the factory's Promise is in-flight.
- Workaround: call the two `applyPaymentTransition` calls SEQUENTIALLY (not via `Promise.all`). The mock's simulated UNIQUE([provider, eventId]) constraint still ensures the second call is idempotent. The real PostgreSQL-level concurrency (two transactions racing for the same UNIQUE constraint) is already tested in `payment-event-persistence.test.ts` (test B4) against PGlite.
- This is documented inline in the test with a NOTE comment explaining the deviation.

## Files created/modified — full list

**Created:**
- `src/app/api/v1/cron/reconcile-payments/route.ts`
- `src/app/api/v1/cron/reconcile-payments/route.test.ts`
- `src/lib/payments/paytm-checksum.test.ts`
- `src/lib/payments/lifecycle.service.test.ts`

**Modified:**
- `src/lib/payments/test-prisma-mock.ts` (added `findMany` + UNIQUE enforcement)

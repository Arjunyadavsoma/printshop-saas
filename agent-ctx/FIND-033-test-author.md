# FIND-033 — API route guard / validation tests

**Agent:** test-author
**Task ID:** FIND-033
**Date:** 2026-11-09
**Files touched:** `src/lib/api/api-routes.test.ts` (new, 342 lines)

## Goal
Address audit finding FIND-033 (zero tests under `src/app/api/`) by adding
unit tests for the auth-guards and validation logic that the API routes depend
on. Tests exercise the guard functions directly — no HTTP layer — so they're
fast, deterministic, and don't need a running Next.js server.

## What was tested
| Section | Source | # tests |
|---|---|---|
| Entitlements middleware | `src/lib/api/entitlements.ts` | 5 |
| db-health endpoint auth | `src/app/api/v1/db-health/route.ts` | 2 |
| Receipt rate-limit wrap | `src/app/api/v1/orders/[id]/receipt/route.ts` | 1 |
| Webhook payment-session lookup | `src/lib/payments/webhook.service.ts` | 3 |
| **Total** | | **11** |

## Test list
1. `isEntitled` returns false for free plan + pro feature
2. `isEntitled` returns true for pro plan + pro feature
3. `requireEntitlement` throws `ForbiddenError` (code `FORBIDDEN`, status 403) when not entitled
4. `getSubscriptionStatus` returns active status with correct tier + daysUntilExpiry
5. `getSubscriptionStatus` returns grace-period flag for recently-expired subscription
6. db-health GET returns 401 when `?key=` is missing/wrong (FIND-011 fix)
7. db-health GET returns 200 + `connection: 'OK'` when the correct key is supplied
8. Receipt route's `GET` export is a function (wrapped with `withRateLimit`, FIND-027 brute-force guard)
9. `lookupPaymentSession` returns null when cache AND DB both miss (and DB fallback was attempted)
10. `rememberPaymentSession` + `lookupPaymentSession` round-trips via cache (DB not touched)
11. `lookupPaymentSession` falls back to `PaymentAttempt.findUnique` on cache miss + re-populates cache

## Patterns used
- In-memory container pattern from `src/lib/auth/auth.test.ts` (fresh per `beforeEach`)
- `vi.mock('@/lib/db', ...)` with `vi.hoisted()` so the webhook DB fallback +
  db-health `$queryRaw` paths can be exercised without a real Postgres instance
- The container's in-memory db (`repos.shops` / `repos.orders`) is used for
  entitlements tests — no mocking of the functions under test
- Each test is fully independent (`beforeEach` resets container + mocks + env)

## Verification
- `npx tsc --noEmit` → 0 errors in the test file. (One pre-existing error in
  `src/lib/payments/webhook.service.ts:53` — adds `merchantOrderId` to a
  `StoredPaymentSession` literal even though the interface doesn't declare it.
  Not introduced by this task; surfaced incidentally.)
- `bunx vitest run src/lib/api/api-routes.test.ts` →
  **11 / 11 passed**, 635 ms total, single file.

## Notes for future work
- The db-health route's Test 2/3 (`information_schema.tables`, `COUNT(*)`) run
  against the mocked `db.$queryRaw` returning `[{test:1}]`. The route tolerates
  the shape mismatch (it's wrapped in try/catch and falls through to
  `'FAILED'` / `'table missing'`). The test only asserts `connection === 'OK'`
  + status 200 — enough to prove the auth guard opens the gate.
- If `webhook.service.ts:53`'s interface drift is fixed (adding
  `merchantOrderId` to `StoredPaymentSession`), test 11's assertion still
  holds — it only reads `orderId`, `shopId`, `amountPaise`, `provider`.

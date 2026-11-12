# Phase 6.9 — Application-Level Payment Integration Certification

**Date:** 2026-11-10
**Branch:** `phase-6-9-payment-application-certification`
**Verdict:** ✅ **PASS** — all P0 scenarios verified against real PostgreSQL 17.11; one P0 bug found + fixed; documentation complete.

---

## Executive summary

Phase 6.9 closes the gap between unit-tested payment code (Prisma mocks +
PGlite) and production reality. The new tests exercise the REAL application
services (`processWebhook`, `applyPaymentTransition`, the checkout route
handler) against a REAL PostgreSQL 17.11 database (`printshop_app_test`)
initialized via `prisma migrate deploy` (all 4 migrations applied). No mocks
of `@/lib/db` — the real Prisma client connects to PostgreSQL.

**One P0 bug was found and fixed:**

The lifecycle service's duplicate-event recovery path queried the existing
PaymentEvent + Order INSIDE the same Prisma `$transaction` after a 23505
unique-violation. PostgreSQL's behavior is that any query issued after a
failed statement in a transaction returns SQLSTATE 25P02 ("current
transaction is aborted"). Prisma's `$transaction` does NOT use SAVEPOINTs,
so the failed `paymentEvent.create` poisoned the entire transaction — the
subsequent `findFirst`/`findUnique` failed with 25P02, the callback
re-threw, and the entire transaction rolled back. The caller (webhook
service) saw a 500 error instead of the expected 200 idempotent response.
The provider would retry, which would fail again — a denial-of-service
vector for duplicate webhooks.

**Fix:** return `idempotent=true` IMMEDIATELY from the catch path (without
querying the poisoned transaction). The caller doesn't need the existing
event's `processingStatus` — `idempotent=true` is sufficient for the
webhook to skip + return 200. The transaction COMMITs (which ROLLBACKs
implicitly because the transaction is aborted — but no mutations were made
before the failed INSERT, so this is a no-op).

Verified in `src/lib/pricing/app-webhook-integration.test.ts` scenarios
4, 5, 14 — all three now return `idempotent=true` cleanly.

---

## Test results

### Task 1 — Application-level webhook integration tests (P0)

**File:** `src/lib/pricing/app-webhook-integration.test.ts`
**Scenarios:** 15 / 15 PASS

| # | Scenario | Result |
|---|----------|--------|
| 1 | Valid signed webhook → PaymentAttempt→paid, Order→paid, PaymentEvent with correct attemptId | ✅ PASS |
| 2 | PaymentEvent references correct PaymentAttempt.id (FK satisfied, not the Order UUID) | ✅ PASS |
| 3 | Unknown attempt → returns early with "PaymentAttempt not found", no PaymentEvent inserted | ✅ PASS |
| 4 | Duplicate provider event → idempotent (23505 caught on second INSERT) | ✅ PASS (after lifecycle fix) |
| 5 | Duplicate webhook cannot double-credit → Order stays paid, no second transition | ✅ PASS (after lifecycle fix) |
| 6 | Invalid amount → rejected, Order stays awaiting_payment | ✅ PASS |
| 7 | Invalid currency → rejected | ✅ PASS |
| 8 | Incorrect merchantOrderId → attempt not found, no PaymentEvent inserted | ✅ PASS |
| 9 | Incorrect provider reference → documented behavior (provider mismatch not rejected at lifecycle; gap documented) | ✅ PASS (documents a known gap) |
| 10 | Incorrect provider signature → webhook rejected (401) before reaching the lifecycle | ✅ PASS |
| 11 | Conflicting success and failure → terminal state wins (failure first, late success cannot regress) | ✅ PASS |
| 12 | Out-of-order callbacks → terminal state cannot be reversed (success first, late failure cannot regress) | ✅ PASS |
| 13 | Transaction failure → rollback, no partial state persisted | ✅ PASS |
| 14 | Concurrent webhook delivery → one consistent final state | ✅ PASS (after lifecycle fix; uses Promise.allSettled to handle Serializable isolation conflicts) |
| 15 | PaymentEvent + PaymentAttempt atomic → both transition together or neither | ✅ PASS |

### Task 2 — Checkout concurrency test (P0)

**File:** `src/lib/pricing/app-checkout-concurrency.test.ts`
**Scenarios:** 1 / 1 PASS

- 20 simultaneous `NextRequest` POST `/api/v1/orders/{id}/checkout` fired
  via `Promise.allSettled` against the real checkout route handler
  (`src/app/api/v1/orders/[id]/checkout/route.ts`).
- All 20 responses return HTTP 200 (no 500 errors).
- All 20 responses reference the SAME `merchantOrderId` (`checkout-${orderId}`
  — the stable idempotency key from Phase 6.3).
- Exactly 1 PaymentAttempt with `status='created'` exists in PostgreSQL
  (verified via the independent `pg` pool — proves the SQL landed, not
  just that Prisma returned the right objects).
- The order stays in `awaiting_payment` (checkout does NOT transition the
  order — the webhook does that).

### Task 3 — Production migration script audit (P0)

**File:** `docs/database/PHASE_6_9_PRODUCTION_MIGRATION_CERTIFICATION.md`
**Staging test target:** disposable `printshop_staging_69` database (dropped after testing).

Findings:
- ✅ The script applies the FULL `schema.prisma` (14 tables, 49 indexes, 12 FKs).
- ✅ All 3 partial unique indexes (`PrintJob_active_file_unique`,
  `Order_shop_tokenNumber_unique`, `PaymentAttempt_active_order_unique`)
  are preserved via `prisma/pg-constraints.sql`.
- ✅ All 12 FK constraints (including the Phase 6.6/6.7 P0 payment FKs:
  `PaymentAttempt_shopId_fkey`, `PaymentAttempt_orderId_fkey`,
  `PaymentEvent_attemptId_fkey`) are present.
- ⚠️ The script is NOT idempotent — re-running on an already-migrated DB
  fails with `relation "Shop" already exists`.
- ⚠️ The verification step's expectations are STALE (hardcoded 8/22/9 vs
  actual 14/49/12) — false-positive warning even on successful deploys.
- ⚠️ No dry-run mode.
- ✅ Safe for first-time deploys to a fresh PostgreSQL database.

### Task 4 — Provider verification matrix

**File:** `docs/payments/PROVIDER_VERIFICATION_MATRIX.md`

Honest summary of what's verified vs. unverified for each provider:
- **PhonePe v1:** signature algorithm verified (forged-valid + invalid sig
  in tests 1 + 10); idempotency verified; sandbox API round-trip UNVERIFIED.
- **PhonePe v2:** SHA auth verified (unit tests); OAuth2 + status API
  UNVERIFIED; fail-closed path verified by code inspection.
- **Paytm:** CHECKSUMHASH algorithm verified (known-vector tests); staging
  API round-trip UNVERIFIED.
- **UPI deep-link:** stub `verifyPayment` (by design); manual shopkeeper
  confirmation required; no server-side webhook.

---

## Full verification block

Run against `phase-6-9-payment-application-certification` branch with
PostgreSQL 17.11 at `127.0.0.1:5433`, database `printshop_app_test`
(initialized via `prisma migrate deploy` — all 4 migrations applied):

```bash
export PGROOT=/tmp/pgroot
export PATH="$PGROOT/usr/lib/postgresql/17/bin:$PATH"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu:$PGROOT/usr/lib/postgresql/17/lib:${LD_LIBRARY_PATH:-}"
export DATABASE_URL="postgresql://z@127.0.0.1:5433/printshop_app_test"
export TEST_DATABASE_URL="postgresql://z@127.0.0.1:5433/printshop_app_test"
```

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `bunx tsc --noEmit` | ✅ PASS (exit 0, no errors) |
| ESLint | `bunx eslint .` | ✅ PASS (exit 0, no errors) |
| Vitest | `bunx vitest run --reporter=dot` | ✅ **47 test files passed, 539 tests passed, 3 skipped (542 total)** |
| Next build | `bunx next build` | ✅ PASS (exit 0, build succeeded) |
| Route conflicts | `bash scripts/check-route-conflicts.sh` | ✅ No dynamic route conflicts |
| Prisma validate | `bunx prisma validate` | ✅ The schema at prisma/schema.prisma is valid |

### Vitest breakdown (542 total)

- **47 test files** — all passed.
- **539 tests passed**, 3 skipped.
- The 2 NEW test files added in Phase 6.9:
  - `src/lib/pricing/app-webhook-integration.test.ts` — 15 / 15 PASS
  - `src/lib/pricing/app-checkout-concurrency.test.ts` — 1 / 1 PASS
- The Phase 6.7 + 6.5 webhook/checkout PostgreSQL tests (which shared the
  same `printshop_app_test` DB) — all PASS after switching their cleanAll
  from `DELETE FROM` to `TRUNCATE CASCADE` (defensive fix to avoid FK
  violations from leftover PrintFile rows).

---

## Files changed in this phase

### New test files (P0)
- `src/lib/pricing/app-webhook-integration.test.ts` — 15 scenarios, 1024 lines
- `src/lib/pricing/app-checkout-concurrency.test.ts` — 1 scenario (20 concurrent requests)

### Production code fixes (P0)
- `src/lib/payments/lifecycle.service.ts` — fixed the duplicate-event
  recovery path to return `idempotent=true` IMMEDIATELY without querying
  the poisoned transaction (was causing 500 errors on duplicate webhooks).

### Existing test fixes (defensive — needed because the new tests share the same DB)
- `src/lib/payments/lifecycle.service.test.ts` — updated scenario 3 to
  expect `orderStatus='unknown'` on the idempotent path (was previously
  expecting 'paid', which required querying the poisoned transaction).
- `src/lib/pricing/webhook-postgres-fk.test.ts` — switched `cleanAll`
  from `DELETE FROM` to `TRUNCATE CASCADE` (FK-aware, handles leftover
  PrintFile rows).
- `src/lib/pricing/checkout-real-postgres.test.ts` — same defensive fix
  to `cleanAndSeed`.

### Documentation (P0)
- `docs/database/PHASE_6_9_PRODUCTION_MIGRATION_CERTIFICATION.md` — full
  audit of `scripts/pg-migrate-prod.sh` + staging test results.
- `docs/payments/PROVIDER_VERIFICATION_MATRIX.md` — honest verification
  matrix for PhonePe v1/v2, Paytm, UPI deep-link.
- `docs/payments/PHASE_6_9_APPLICATION_INTEGRATION.md` — this file.

---

## Bugs found + recommendations

### P0 — Fixed: lifecycle duplicate-event recovery path (25P02)

**Bug:** `applyPaymentTransition`'s catch for 23505 unique-violation
queried the existing PaymentEvent + Order INSIDE the same Prisma
`$transaction`. PostgreSQL poisons the transaction after a failed INSERT
(SQLSTATE 25P02), so the subsequent `findFirst`/`findUnique` failed +
the transaction rolled back. The webhook service returned 500 (instead
of the expected 200 idempotent) → provider retried → same failure →
denial-of-service.

**Fix:** return `idempotent=true` immediately from the catch path
without querying. The transaction COMMITs (→ implicit ROLLBACK, no-op
since no mutations before the failed INSERT). Verified in scenarios
4, 5, 14.

**Severity:** P0 — every duplicate webhook (which providers send
routinely) would have caused a 500 + retry storm in production.

### P1 — Documented gap: provider mismatch not rejected at lifecycle

**Bug:** `applyPaymentTransition` does NOT validate that
`input.provider === attempt.provider`. A Paytm webhook could transition
a PhonePe attempt (and vice versa). The PaymentEvent records the wrong
provider; the attempt transitions regardless.

**Current behavior:** documented honestly in
`app-webhook-integration.test.ts` scenario 9 + the
`PROVIDER_VERIFICATION_MATRIX.md`. The transition succeeds (gap).

**Recommendation:** add a provider-mismatch guard in
`applyPaymentTransition` between STEP 1 (find attempt) and STEP 2
(insert PaymentEvent). Mirror the amount/currency guard: update the
PaymentEvent to `processingStatus='skipped'` + return
`reason='provider mismatch'`.

**Severity:** P1 — a misconfigured webhook (e.g. pointing the Paytm
callback URL at the PhonePe webhook endpoint) would silently transition
the wrong attempt. Not exploitable by an attacker (signature
verification still catches forged webhooks), but a real misconfiguration
risk.

### P1 — Documented gap: PhonePe v2 OAuth2 token refresh-on-401 missing

**Bug:** the PhonePe v2 OAuth2 token cache doesn't have a 401-retry
path. If PhonePe returns 401 on a status check (token expired between
the cache check + the API call), the handler catches the error + fails
closed (payment held for reconciliation). Safe but may cause
false-negative verifications during token rotation.

**Recommendation:** add a 401-retry path that invalidates the cached
token + retries once.

**Severity:** P1 — operational impact (false negatives during token
rotation), not a security issue (fail-closed is safe).

### P2 — Recommendations for `pg-migrate-prod.sh`

1. Add idempotency guard (pre-check `information_schema.tables` count).
2. Update verification expectations (14/49/12 instead of 8/22/9).
3. Add `--dry-run` flag.
4. Wrap DDL + constraints in a single transaction.
5. Record ALL 4 migrations in `_prisma_migrations` (not just the baseline).

---

## Verdict

✅ **Phase 6.9 PASS.** All P0 scenarios verified against real PostgreSQL
17.11. The lifecycle duplicate-event bug (P0) was found + fixed. The
production migration script was audited + tested against a disposable
staging database. Provider verification matrix documents honestly what's
verified vs. unverified.

**Ready for production deploy** with the caveat that provider sandbox
credentials (PhonePe, Paytm) are NOT configured in this environment —
the signature algorithms + idempotency guards + fail-closed paths are
verified, but the actual HTTP round-trip to provider APIs is UNVERIFIED.
Obtain sandbox credentials + run an end-to-end test before going live
with real payments.

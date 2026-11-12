# Phase 6.11 — Staging Release Certification

## Verdict: READY WITH LIMITATIONS

All critical payment integrity, migration, and security requirements pass with reproducible evidence. Three workstreams could not be executed due to unavailable sandbox credentials and staging deployment access.

## Starting and final commits
- **Starting:** `7b9f697` (Phase 6.10)
- **Final:** (this commit)
- **Branch:** `phase-6-11-staging-release-certification`
- **Remote main:** `bf71183` (unchanged)

## Workstream A — Existing-database migration rehearsal

### Database A — Clean installation
- `prisma migrate deploy` on empty PostgreSQL 17.11
- **5 migrations applied** (init, missing columns, delivery, payment tables, FK constraints)
- **14 tables** created, all indexes and FK constraints verified

### Database B — Existing installation rehearsal
- Applied all 5 migrations, inserted representative data (shop, order, file, payment attempt)
- Re-ran `prisma migrate deploy` → "No pending migrations to apply" (idempotent)
- **All existing data preserved** (1 shop, 1 order, 1 file, 1 attempt — unchanged)
- Partial unique index, FK constraint, migration history all verified

### Missing columns fix
- Found 12 missing Shop columns + 1 missing Order column via `prisma migrate diff`
- Created migration `20251107000001_add_missing_schema_columns` with idempotent `ADD COLUMN IF NOT EXISTS`
- All columns now present after `prisma migrate deploy`

## Workstream B — Unknown webhook recovery

**Fix:** `webhook.service.ts` now returns **404** (not 200) when `applyPaymentTransition` reports "PaymentAttempt not found". This signals the provider to retry the webhook. The previous 200 response told the provider "OK, don't retry" — which could lose legitimate events.

**Recovery path:** Provider retries → PaymentAttempt becomes available → webhook succeeds. Reconciliation cron (every 10 min) also calls `verifyPayment` for stale attempts.

## Workstream C — Checkout concurrency
- 20 simultaneous requests → exactly 1 PaymentAttempt, no 500 errors (verified in Phase 6.9)
- Stable merchantOrderId, winner retrieval on UNIQUE conflict

## Workstream D — PhonePe sandbox: NOT EXECUTED
No PhonePe sandbox credentials available. Signature algorithms verified via test vectors.

## Workstream E — Paytm sandbox: NOT EXECUTED
No Paytm sandbox credentials available. Checksum algorithm verified via test vectors.

## Workstream F — UPI manual confirmation
- Owner-only authorization via `withAuth(['owner'])`
- Tenant-scoped via `repos.shops.getByOwner(principal.userId)`
- Deterministic txnId `manual-${order.id}` prevents duplicates
- Audit log records actor, timestamp, amount, reference
- `verifyPayment` stub returns `{ paid: false }` — manual confirmation required

## Workstream G — Staging cron execution: NOT EXECUTED
No staging deployment access. Local route tests verify auth, batching, idempotency.

## Workstream H — Security audit
- Webhook signature verification before state mutation ✅
- Constant-time comparisons (timingSafeEqual) ✅
- No secrets in query strings (removed in Phase 6.7) ✅
- Tenant isolation enforced server-side ✅
- Payment amounts server-authoritative ✅
- Rate limiting with TRUSTED_PROXY ✅

## Workstream I — Skipped tests (3)
1. `checkout-idempotency.test.ts:187` — N/A (deterministic key)
2. `checkout-idempotency.test.ts:308` — Requires real webhook delivery
3. `fail-closed-verification-tests.test.ts:165` — Needs PhonePe credentials

All three are legitimate, documented, non-blocking.

## Full verification

| Check | Exit | Result |
|---|---|---|
| `prisma migrate deploy` (clean) | 0 | ✅ 5 migrations, 14 tables |
| `prisma migrate deploy` (existing DB) | 0 | ✅ Idempotent, data preserved |
| `bunx tsc --noEmit` | 0 | ✅ Clean |
| `bunx eslint .` | 0 | ✅ Clean |
| `bunx vitest run` | 0 | ✅ 546 passed, 3 skipped (48 files) |
| `bunx next build` | 0 | ✅ Compiled successfully |
| `bash scripts/check-route-conflicts.sh` | 0 | ✅ No conflicts |
| `bunx prisma validate` | 0 | ✅ Schema valid |

## Remaining limitations
1. PhonePe sandbox: NOT EXECUTED (no credentials)
2. Paytm sandbox: NOT EXECUTED (no credentials)
3. Staging cron: NOT EXECUTED (no staging deployment)
4. UPI verifyPayment stub: manual confirmation required
5. 3 skipped tests: all pre-existing, documented

## Production safety
✅ No production data modified
✅ No production migrations run
✅ No real payments initiated
✅ No deployment triggered
✅ Remote main unchanged (bf71183)
✅ No force-push
✅ No credentials in Git
✅ PrintEXE not modified

## Release recommendation
The payment system is safe to deploy to a staging environment for provider sandbox testing. Before production deployment:
1. Obtain PhonePe and Paytm sandbox credentials and execute Workstreams D and E
2. Deploy to staging and verify cron execution (Workstream G)
3. Confirm the GitHub PAT used in previous phases has been revoked
4. Use `prisma migrate deploy` (not `pg-migrate-prod.sh`) as the canonical migration path

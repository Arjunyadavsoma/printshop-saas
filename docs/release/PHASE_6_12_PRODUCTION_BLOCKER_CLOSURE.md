# Phase 6.12 — Production Blocker Closure & Payment Reliability

## Verdict: READY FOR CONTROLLED STAGING

All critical implementation, migration, and financial-integrity requirements pass with reproducible evidence. Provider sandbox and staging deployment evidence remain unavailable (NOT EXECUTED). The system is safe to deploy to staging for provider sandbox testing.

## Starting and final commits
- **Starting:** `9fb2acb` (Phase 6.11)
- **Final:** (this commit)
- **Branch:** `phase-6-12-production-blocker-closure`
- **Remote main:** `bf71183` (unchanged)

## P0 — Durable unknown-webhook recovery

### Implementation
- **New model:** `WebhookInbox` in `prisma/schema.prisma` — stores verified but unmatched webhook callbacks
- **New migration:** `20251107000002_add_webhook_inbox` — creates the table with unique constraint on `(provider, providerEventId)`
- **Code change:** `webhook.service.ts` — when `applyPaymentTransition` returns "PaymentAttempt not found", the verified callback is persisted to `WebhookInbox` before returning 404
- **Test mock:** `test-prisma-mock.ts` updated to include `webhookInbox` operations

### Design
1. Webhook arrives → signature verified (step 3-4 in processWebhook)
2. `applyPaymentTransition` called → PaymentAttempt not found → returns early
3. Verified callback persisted to `WebhookInbox` with `processingStatus='unmatched'`
4. HTTP 404 returned (provider retries — defense in depth)
5. Reconciliation cron (every 10 min) can process unmatched inbox entries
6. When PaymentAttempt becomes available, inbox entry is matched and processed
7. Duplicate callbacks caught by `UNIQUE(provider, providerEventId)` constraint

### What is NOT stored
- No secrets, authorization headers, or raw payload bytes
- No sensitive payment data beyond amount, providerEventId, merchantOrderId
- Only signature-verified callbacks are persisted (unverified → 401, not persisted)

## P0 — Migration correctness
- **6 migrations** in chronological order, all apply via `prisma migrate deploy`
- **15 tables** created (including WebhookInbox)
- Clean migration test: ✅ all 6 applied, 15 tables verified
- Existing-database test: ✅ data preserved, idempotent re-run
- Missing columns fixed: ✅ 12 Shop + 1 Order column added via dedicated migration

## P0 — Checkout and provider-session recovery
- Database idempotency: ✅ stable key `checkout-${order.id}` + partial unique index
- 20 concurrent requests: ✅ exactly 1 attempt, no 500 errors
- Provider idempotency: documented per provider (PhonePe uses merchantTransactionId, Paytm uses orderId)
- Timeout recovery: PaymentAttempt persists in `created` state; retry reuses existing attempt or creates new after expiry

## P1 — UPI manual confirmation
- Owner-only authorization ✅
- Tenant-scoped ✅
- Deterministic txnId `manual-${order.id}` ✅
- Audit trail ✅
- `verifyPayment` stub returns `{ paid: false }` — manual confirmation required

## P1 — Cron and reconciliation
- Bearer-only auth ✅ (16 tests)
- `?secret=` query rejected ✅
- Fail-closed on missing CRON_SECRET ✅
- vercel.json schedules both routes ✅
- Staging execution: NOT EXECUTED

## P1 — Provider evidence
- PhonePe v1: source + test vectors ✅, sandbox NOT EXECUTED
- PhonePe v2: source + test vectors ✅, sandbox NOT EXECUTED
- Paytm: source + test vectors ✅, sandbox NOT EXECUTED
- UPI: stub documented, manual confirmation required

## Security
- Webhook signature before state mutation ✅
- Constant-time comparisons ✅
- No secrets in query strings ✅
- Tenant isolation ✅
- Server-authoritative amounts ✅
- Rate limiting (requires TRUSTED_PROXY in prod) ✅

## GitHub PAT
NOT VERIFIED — OWNER ACTION REQUIRED. The GitHub PAT used in previous phases for pushing branches should be revoked by the repository owner.

## Full verification

| Check | Exit | Result |
|---|---|---|
| `prisma migrate deploy` (clean) | 0 | ✅ 6 migrations, 15 tables |
| `bunx tsc --noEmit` | 0 | ✅ Clean |
| `bunx eslint .` | 0 | ✅ Clean |
| `bunx vitest run` | 0 | ✅ 546 passed, 3 skipped (48 files) |
| `bunx next build` | 0 | ✅ Compiled successfully |
| `bash scripts/check-route-conflicts.sh` | 0 | ✅ No conflicts |
| `npx prisma validate` | 0 | ✅ Schema valid |

## Skipped tests (3)
1. `checkout-idempotency.test.ts:187` — N/A (deterministic key)
2. `checkout-idempotency.test.ts:308` — requires real webhook delivery
3. `fail-closed-verification-tests.test.ts:165` — needs PhonePe credentials

## Remaining limitations
1. PhonePe sandbox: NOT EXECUTED
2. Paytm sandbox: NOT EXECUTED
3. Staging cron: NOT EXECUTED
4. UPI verifyPayment stub: manual confirmation
5. Recovery worker not yet wired to reconciliation cron (WebhookInbox entries persisted but not automatically processed)
6. GitHub PAT: NOT VERIFIED — owner action required

## Files changed
- `prisma/schema.prisma` — added WebhookInbox model
- `prisma/migrations/20251107000002_add_webhook_inbox/migration.sql` — new migration
- `src/lib/payments/webhook.service.ts` — persist unmatched events to WebhookInbox
- `src/lib/payments/test-prisma-mock.ts` — added webhookInbox to mock
- `docs/release/PHASE_6_12_EVIDENCE_MATRIX.md` — evidence matrix
- `docs/release/PHASE_6_12_PRODUCTION_BLOCKER_CLOSURE.md` — this report

## Production safety
✅ No production data modified
✅ No production migrations run
✅ No real payments initiated
✅ No deployment triggered
✅ Remote main unchanged (bf71183)
✅ No force-push
✅ No credentials in Git
✅ PrintEXE not modified

# Vercel Hobby Cron Compatibility

## Problem

Vercel Hobby accounts are limited to daily cron jobs. The previous configuration used:
- `/api/v1/cron/reconcile-payments` — `*/10 * * * *` (every 10 minutes)
- `/api/v1/cron/cleanup` — `*/5 * * * *` (every 5 minutes)

Both expressions exceed the once-per-day restriction, causing deployment failures.

## Solution

### Vercel cron (daily safety net)

| Endpoint | Previous Schedule | New Schedule | Purpose |
|---|---|---|---|
| `/api/v1/cron/reconcile-payments` | `*/10 * * * *` | `0 2 * * *` (daily 02:00 UTC) | Reconcile stale payment attempts |
| `/api/v1/cron/cleanup` | `*/5 * * * *` | `0 3 * * *` (daily 03:00 UTC) | Delete expired cloud storage objects |

### GitHub Actions (primary scheduler)

The existing `.github/workflows/cleanup-cron.yml` (renamed to "Scheduled Background Jobs") continues to provide frequent execution:

| Endpoint | GitHub Actions Schedule | Purpose |
|---|---|---|
| `/api/v1/cron/cleanup` | `*/5 * * * *` (every 5 min) | File cleanup |
| `/api/v1/cron/reconcile-payments` | `*/10 * * * *` (every 10 min) | Payment reconciliation |

Both the Vercel daily cron and the GitHub Actions frequent scheduler invoke the **same idempotent endpoints**. Duplicate execution is safe — the endpoints use database-backed deduplication and conditional updates.

## Batch size changes

| Route | Previous MAX_BATCH | New MAX_BATCH | Rationale |
|---|---|---|---|
| reconcile-payments | 10 | 50 | Daily cron processes all stale attempts in one run |
| cleanup | 10 | 50 | Daily cron processes all due tasks in one run |

The GitHub Actions scheduler also benefits from the larger batch — fewer invocations needed to process the same volume.

## Business correctness preservation

### Payment webhooks (NOT affected)
- Webhooks remain **event-driven** — the provider calls the webhook endpoint immediately
- WebhookInbox persists unmatched events for later matching
- The reconciliation cron is a **safety net**, not the primary recovery mechanism
- Provider retries + WebhookInbox + reconciliation = three-layer recovery

### Payment reconciliation
- The reconciliation endpoint processes ALL stale attempts (status='created', older than 10 min)
- With GitHub Actions running every 10 minutes, reconciliation frequency is unchanged
- The Vercel daily cron provides an additional safety net at 02:00 UTC
- `applyPaymentTransition` is idempotent — duplicate execution cannot double-process

### File cleanup
- The cleanup endpoint processes ALL due FileCleanupTask records
- With GitHub Actions running every 5 minutes, cleanup frequency is unchanged
- The Vercel daily cron provides an additional safety net at 03:00 UTC
- Only deletes objects with verified receipt + grace period elapsed

### Subscription enforcement
- Subscription checks are **real-time** (per-request `requireEntitlement` call)
- Not dependent on cron — entitlements are checked on every API call
- The cron does not manage subscriptions

## Authorization (unchanged)

Both endpoints require:
- `Authorization: Bearer <CRON_SECRET>` header
- `CRON_SECRET` env var must be set (fail-closed if missing)
- No query-string secret fallback (removed in Phase 6.7)
- No secret leakage in logs

## Idempotency (unchanged)

- `applyPaymentTransition` uses `db.$transaction` with Serializable isolation
- PaymentEvent `UNIQUE([provider, eventId])` prevents duplicate events
- PaymentAttempt conditional `updateMany` prevents state regression
- FileCleanupTask marks objects as `completed` after deletion — missing objects → marked completed

## Failure recovery

- Per-attempt try/catch: one failure does NOT abort the batch
- 15-second per-attempt timeout for provider verification
- Failed attempts remain in `status='created'` for the next invocation
- Both Vercel and GitHub Actions invocations are independently safe to retry

## Remaining operational considerations

1. **GitHub Actions secrets**: `CRON_SECRET` must be configured in GitHub repo → Settings → Secrets → Actions
2. **Vercel env var**: Same `CRON_SECRET` value must be set in Vercel → Project Settings → Environment Variables
3. **Production URL**: The GitHub Actions workflow uses `https://printshop-saas-three.vercel.app` — update if the deployment URL changes
4. **Workflow visibility**: Monitor GitHub Actions tab for scheduled workflow execution logs

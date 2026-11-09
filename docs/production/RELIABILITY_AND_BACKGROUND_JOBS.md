# Reliability & Background Jobs

**Status:** Production reference for the Vercel serverless reliability
model, the in-memory adapters configured in production, the external
cron that drives file cleanup, and the stale-job recovery / retry
behavior that keeps the print pipeline consistent.
**Source of truth:** `vercel.json`, `src/lib/container.ts`,
`src/lib/services/durable-queue.ts`,
`src/lib/services/delivery-coordinator.ts`,
`src/app/api/v1/cron/cleanup/route.ts`,
`.github/workflows/cleanup-cron.yml`, `prisma/schema.prisma`.

---

## 1. Vercel Serverless Constraints

Deployed as a Next.js app on Vercel (`vercel.json` →
`framework: nextjs`, `regions: ["bom1"]`). Three constraints shape every
reliability decision:

1. **10 s function duration cap** (Hobby default). No request handler
   can assume it owns the process longer than that — long-running work
   must be offloaded to the DB + an external cron.
2. **In-memory state is per-invocation.** Each function instance is a
   fresh process with its own `Map`s. The container caches itself on
   `globalThis.__printshopContainer` (`src/lib/container.ts`) so state
   survives route-handler module re-evaluations *within a warm
   instance*; cold starts recreate it.
3. **No long-lived worker.** Anything that polls (file cleanup,
   stale-job recovery, realtime fan-out) cannot run as a `setInterval`
   inside a function — Vercel tears the instance down. It must be a
   cron-triggered function (with its own auth) or an external
   mini-service.

The `vercel.json` `env` block codifies the production adapter selection:

```jsonc
{
  "REALTIME_PROVIDER": "memory",   // → InMemoryRealtimeAdapter
  "CACHE_PROVIDER":    "memory",   // → InMemoryCacheAdapter
  "DATABASE_PROVIDER": "prisma",   // → PrismaDatabaseAdapter (PostgreSQL)
  "STORAGE_PROVIDER":  "supabase"
}
```

`memory` for realtime + cache is intentional *for the pilot* and is a
known limitation, not a misconfiguration (see §2 and §6).

---

## 2. Realtime: `REALTIME_PROVIDER=memory` in Production

`buildContainer()` in `src/lib/container.ts` picks the realtime adapter
by `REALTIME_PROVIDER`:

- `'socketio'` (default if unset) → `SocketIoRelayRealtimeAdapter`,
  which POSTs `emit` calls to a separate socket.io mini-service
  (`mini-services/realtime-service/`, deployed separately).
- `'memory'` (what production actually sets) →
  `InMemoryRealtimeAdapter`, an in-process `EventEmitter`. Events
  published in one function instance never reach another instance, and
  never reach the dashboard client.

**Practical effect:** push-based dashboard updates (`order.paid`,
`job.dispatch`, `job.needs_review`, `order.ready`, `order.collected`)
**do not work in production today.** The dashboard's `useRealtime()`
hook (`src/components/phase5/use-realtime.ts`) tries a socket.io
connection to `/?XTransformPort=3003`; on failure `connected=false` and
the caller falls back to polling. The shop dashboard
(`src/components/phase5/shop-dashboard.tsx`) and the order detail page
both poll on a timer when realtime is unavailable.

Acceptable for a pilot; means dashboard freshness = polling interval,
not push latency. The fix is in §6.

---

## 3. Cache: `CACHE_PROVIDER=memory` in Production

`validateCacheProvider()` in `src/lib/container.ts` runs at container
build. In production with `CACHE_PROVIDER=memory` it **warns and
continues** (previously fatal; relaxed so the app stays bootable on
Vercel) — the DB UNIQUE on `Order.paymentTxnId` remains the
authoritative payment-idempotency guard.

| Subsystem | Effect of `memory` provider |
| --------- | --------------------------- |
| **Rate limiting** (`rate-limit.ts`) | Per-invocation counters; bursts across distinct instances are NOT aggregated → effectively unbounded under cold-start concurrency. |
| **Payment idempotency** (`pay:done:{provider}:{txnId}`, 24 h) | Lost on cold start → falls through to DB UNIQUE → idempotent skip, but slower. |
| **Payment session lookup** (`pay:moid:{merchantOrderId}`, 10 min) | Lost on cold start → falls through to `PaymentAttempt` DB table (durable). |
| **Token revocation** | Per-invocation; a revoked JWT may be accepted by a fresh instance that hasn't seen the revocation entry. |

`/api/v1/ready` treats cache as **not mandatory** when
`provider === 'memory'`, so the probe doesn't fail. Setting
`CACHE_PROVIDER=redis` without `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` is detected and falls back to `memory` with
an `error` log (not a crash).

---

## 4. Cleanup Cron: GitHub Actions → Vercel Function

Because Vercel Cron on Hobby is limited, file cleanup is driven by
**GitHub Actions** scheduling instead. The full loop:

**Trigger** — `.github/workflows/cleanup-cron.yml` runs `cron: '*/5 * * * *'`
(UTC) + `workflow_dispatch` for manual ops. It curls
`https://printshop-saas-three.vercel.app/api/v1/cron/cleanup` with
`Authorization: Bearer ${{ secrets.CRON_SECRET }}`.

**Auth** — the endpoint validates the `Authorization: Bearer
<CRON_SECRET>` header (or `?secret=` query for manual curl) against
`process.env.CRON_SECRET` (falls back to `SETUP_KEY` for the legacy
setup). Missing/wrong secret → `401`, no work done. The secret must be
set in **both** GitHub repo secrets (Actions) and Vercel env vars.

**Work** — `processCleanupTasks(maxTasks=10)` in
`src/lib/services/delivery-coordinator.ts`:

1. `findMany` on `FileCleanupTask` where `status='pending'` AND
   `scheduledAt <= now`, ordered by `scheduledAt` asc, `take: 10`
   (endpoint allows `?limit=` up to 50).
2. For each task: `storage.head(storageKey)` — already gone → mark
   `completed` (idempotent). Otherwise `storage.deleteMany([storageKey])`,
   then `completed`.
3. On error: `attempts++`, set `lastError`; if `attempts + 1 >=
   maxAttempts` → `status='failed'` (terminal); else leave `pending`.

**`FileCleanupTask` row** (`schema.prisma:307-325`): `printFileId`,
`shopId`, `storageKey`, `cleanupType` (`after_receipt` default |
`after_collect` | `forced`), `scheduledAt`, `completedAt`, `attempts`,
`maxAttempts` (default **5**), `lastError`, `status`
(`pending | completed | failed | skipped`). Indexed
`[shopId, status]`, `[scheduledAt]`, `[printFileId]`.

**Scheduling** — `markDeliveryReceived()` creates the task with
`scheduledAt = now + 15 min` (grace period for re-download if the
receipt ack raced with a printer problem). Only objects with a verified
receipt + elapsed grace get cleaned up — the cron never deletes a file
that was never acknowledged.

**Operational invariants:** **bounded** (`take` ≤ 50 so a backlog can't
blow the 10 s cap); **idempotent** (missing object → `completed`);
**never deletes business records** (only the storage object; `PrintFile`
+ `Order` rows persist for the daily report); returns operational stats
(`pendingTasks`, `failedTasks`, `oldestPendingAge`) so a missing
`CRON_SECRET` or backlog is visible in the response body.

---

## 5. Stale Job Recovery & Retries

### 5.1 Stale print jobs (`recoverStaleJobs`)

The print queue **is the `PrintJob` table** — there is no separate
queue service. Jobs sit in `status='queued'` until an agent claims them
(`POST /agents/jobs/:id/status`: `queued → printing`). If the agent
(or the function driving it) crashes mid-print, the job is stuck in
`printing` forever.

`recoverStaleJobs()` in `src/lib/services/durable-queue.ts` is the
recovery path. It is called **lazily on first container build**
(`getContainer()` in `src/lib/container.ts`, guarded by
`globalThis.__printshopStartupMaintenanceStarted` so it runs once per
warm instance) as a fire-and-forget — the first API request of a cold
instance triggers it but is not blocked by it.

Algorithm (`STALE_THRESHOLD_MS = 5 * 60 * 1000`):

- Find `PrintJob` rows with `status='printing'` (optionally scoped by
  `shopId`), `take: 50`.
- For each whose `startedAt < now - 5 min`: update `status` to
  **`needs_review`** (NOT back to `queued`), best-effort update
  `PrintFile.status` too, publish a `job.needs_review` realtime event.

**Why `needs_review` and not `queued`:** the previous worker may have
*actually printed* the file but failed to ack. Auto-re-queuing would
cause duplicate printing. A shopkeeper must inspect and either
`requeueJob()` (confirms NOT printed → `queued`) or `markJobCompleted()`
(confirms printed → `completed`). "Fail safe, not fast" — duplicate
prints are far worse than a brief delay for review.

### 5.2 Retry budgets

| Subsystem | Policy | Source |
| --------- | ------ | ------ |
| **File cleanup** | `maxAttempts=5` per task; `attempts++` on each failure; terminal `failed` at 5. The 5-min cron cadence *is* the backoff. | `schema.prisma:316`; `delivery-coordinator.ts` |
| **socket.io reconnect** | `reconnection:true`, `attempts=10`, `delay=1500` ms (client default exp factor 1.5). | `use-realtime.ts:30` |
| **Order detail reconnect** | `delay = min(2000 * 2^attempt, 30000)` — pure exponential, base 2 s, cap 30 s. | `shop/orders/[id]/page.tsx:994` |
| **PSP API calls** | `AbortSignal.timeout(30_000)` (create/refund), `15_000` (status); no in-adapter retry → fail fast to fallback UPI deep-link. | `phonepe.adapter.ts`, `paytm.adapter.ts` |
| **Agent print job claim** | No auto-retry; job stays `queued` until agent polls `/jobs/pending` or receives `job.dispatch` (published best-effort). | `delivery-coordinator.ts` |

### 5.3 Print job idempotency (two-layer guard)

When a paid order is enqueued for printing (`enqueuePaidOrderPrint` →
`enqueueFilePrint` in `src/lib/services/print.service.ts`), the helper
prevents duplicate `PrintJob` rows under concurrent webhook + manual
`/start` calls: **pre-check** `findActiveByFile(fileId)` (return the
existing active job without inserting if one exists), then **catch** the
P2002 on insert against the partial unique index
`PrintJob_active_file_unique` (concurrent insert wins → return that row).
Same pattern as the payment idempotency guard — fast-path pre-check,
authoritative DB UNIQUE catch.

---

## 6. Recommendations

Operational changes (no code edits) that move the pilot to a durable
multi-instance deployment.

1. **Deploy the realtime mini-service on Render.** The
   `mini-services/realtime-service/` package is a standalone socket.io
   server; `render.yaml` already declares it. Set
   `REALTIME_PROVIDER=socketio` + `REALTIME_EMIT_URL` +
   `REALTIME_EMIT_SECRET` in Vercel env vars and the dashboard flips
   from polling to true push.
2. **Configure Upstash Redis for the cache.** Set `CACHE_PROVIDER=redis`
   + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Restores
   cross-instance rate limiting and makes `pay:done:` / `pay:moid:`
   durable across cold starts. `PaymentAttempt` DB stays authoritative;
   Redis is the fast path.
3. **Move cleanup to Vercel Cron (Pro) or keep GitHub Actions.** Either
   way, **never** run cleanup as an in-function `setInterval` — the 10 s
   cap kills it.
4. **Add alerting on the cleanup response body.** Fail the Actions run
   (or a Vercel monitor) when `failedTasks > 0` or `oldestPendingAge` is
   older than 30 min.
5. **Run `recoverStaleJobs` on a schedule.** Today it fires only once
   per cold instance. Add `/api/v1/cron/recover-stale` (same
   `CRON_SECRET` auth) called by a second Actions cron at */10 min.
6. **Document the memory-cache degraded mode.** Until Redis is in,
   rate-limit / token-revocation investigations must account for
   per-invocation counters undercounting. The DB UNIQUE on
   `paymentTxnId` is the financial safety net.

---

## 7. Failure Mode Summary

| Failure | Detection | Recovery |
| ------- | --------- | -------- |
| 10 s function cap hit | Vercel 504; final audit step may be missing | PSP retries the webhook; client polls status |
| Realtime mini-service down | `useRealtime()` → `connected=false` | Dashboard falls back to polling; no data loss |
| Cache cold (`memory` provider) | Cache miss returns `null` | Falls through to DB (`PaymentAttempt` / `paymentTxnId` UNIQUE) |
| Cleanup cron missed a run | Actions history; `oldestPendingAge` climbing | Next 5-min run picks up backlog; tasks stay `pending` |
| Cleanup task fails repeatedly | `attempts` reaches `maxAttempts=5` → `failed` | Manual investigation; re-create with `forced` type |
| Agent crashed mid-print | `PrintJob.status='printing'` older than 5 min | `recoverStaleJobs()` → `needs_review` → shopkeeper inspects |
| Duplicate webhook / print enqueue | Cache hit OR DB UNIQUE P2002 | Idempotent skip; logged |
| Storage adapter degraded | `/api/v1/ready` 503 on storage check | Cleanup tasks retry 5x then `failed`; files serve through grace window |

# Monitoring & Incident Response

> Observability stack, alert definitions, and the on-call runbook for PrintShop
> SaaS in production. Every claim is sourced from the actual codebase.

---

## 1. Observability surface

### 1.1 Structured JSON logs

`JsonConsoleLogger` (`src/lib/logger/json-logger.adapter.ts`) is the production
logger concrete, wired in `src/lib/container.ts` as
`new JsonConsoleLogger({ service: 'printshop-api' })`. Every log line is a
single JSON object written to stdout — pino-compatible shape, ingestible by
Axiom / Logtail / Vercel Logs without parsing.

```ts
// json-logger.adapter.ts (lines 13–22)
private write(level, message, context) {
  const line = { level, message, time: Date.now(), ...this.base, ...(context ?? {}) };
  console.log(JSON.stringify(line));
}
```

Shape: `{ service, level, message, time, …context }`. The base context is
`{ service: 'printshop-api' }` and stays on every line via the `child()`
factory. Levels: `debug` (gated by `LOG_LEVEL=debug`), `info`, `warn`, `error`.

### 1.2 Request IDs

Every authenticated / rate-limited route goes through `timed()` in
`src/lib/api/with-auth.ts` (lines 11–28):

```ts
async function timed<P>(req, fn) {
  const rid = requestId(req);              // honour inbound X-Request-Id or mint UUID
  const start = Date.now();
  let res;
  try { res = await fn(); }
  catch (cause) { res = fail(toAppError(cause)); }
  const dur = Date.now() - start;
  logRequest(getContainer().logger, req.method, path, res.status, dur, rid);
  try { res.headers.set('x-request-id', rid); } catch {}
  return res;
}
```

The id is **echoed back on the response** (`X-Request-Id` header) so a client
can include it in a bug report and the operator can grep the exact log line.
`requestId()` (in `envelope.ts:93`) honours an inbound `X-Request-Id` header
if the client provides one — useful for end-to-end traces from the customer
portal.

Logged fields per request:
`{ service, level: 'info', message: 'request', method, path, status, durationMs, requestId }`.

### 1.3 Health checks

Two distinct probes:

| Probe | Route | Checks | Returns |
|---|---|---|---|
| **Liveness** | `GET /api/v1/health` | Process is up | `200 { status: 'ok' }` always |
| **Readiness** | `GET /api/v1/ready` | DB + storage + cache + realtime | `200` if all healthy, `503` if any dep is down |

Liveness (`src/app/api/v1/health/route.ts`) is a static "the server can execute JS" check — it does NOT touch the DB. Use it for Vercel/uptime monitors that should alert only if the runtime itself is wedged.

Readiness (`src/app/api/v1/ready/route.ts`) runs each dependency through a `withTimeout(promise, 5000)` race — 5 s budget per dep:

- **Database** (always): `c.db.ping()` → `SELECT 1`.
- **Storage** (mandatory if `STORAGE_PROVIDER != memory`): `head('__readiness_probe__')` — null (not-found) is treated as **healthy**.
- **Cache** (mandatory if `CACHE_PROVIDER != memory`): `get('__readiness_probe__')`.
- **Realtime** (mandatory if `REALTIME_PROVIDER != memory`): publish to a noop channel.

The probe **never** exposes connection strings, credentials, or stack traces. Rate-limited at 30 req/min (`withRateLimit('ready', 30, 60, …)`).

### 1.4 Diagnostic: `/api/v1/db-health`

`src/app/api/v1/db-health/route.ts` — admin-only diagnostic returning env-var
presence flags (boolean, no values), masked `DATABASE_URL`, `SELECT 1` result,
list of `public.*` tables, and row counts for `User` + `Shop`. Auth: admin
JWT OR `?key=<SETUP_KEY>`. **Do not expose to unauthenticated callers** — it
leaks env-var presence which is itself a footprint for attackers.

### 1.5 Audit logs

`AuditLog` model (`prisma/schema.prisma` lines 175–189) captures every
state-changing action: `shopId` (tenant scope), `userId` (actor), `action`
(e.g. `order.status_changed`), `entityType` + `entityId` (target),
`metadata` (JSON string), `ip`, `createdAt` (`@@index([shopId, createdAt])`).

`AuditLogRepository.log()` (`audit-log.repository.ts:18`) is **best-effort**
— it swallows all errors so an audit failure can never break the user flow.
Entries are pruned to 30 days on startup (`container.ts:381` via
`recoverStaleJobsOnStartup`) to keep the Neon free-tier DB under its 0.5 GB
cap. Surface: `GET /api/v1/admin/audit` (admin-only) lists recent entries
cross-shop; `findByShop` / `findByEntity` power shop-scoped views.

### 1.6 Error tracking (Sentry integration point)

`toAppError()` in `src/lib/api/envelope.ts` (lines 43–53) is the single funnel
through which every thrown value flows:

```ts
export function toAppError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  if (cause instanceof ZodError) return new ValidationError(...);
  if (cause instanceof Error) {
    captureSentry(cause);           // ← the integration point
    return new AppError(cause.message, 'INTERNAL_ERROR', 500);
  }
  return new AppError('Unknown error', 'INTERNAL_ERROR', 500);
}
```

`captureSentry()` (lines 62–70) is a **stub**: it reads `SENTRY_DSN` from env
and no-ops if unset. To wire production Sentry:

1. `bun add @sentry/node`
2. In `src/lib/container.ts` (or `src/instrumentation.ts`), call
   `Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 })`
   before `getContainer()`.
3. Replace the body of `captureSentry()` with `Sentry.captureException(err)`.
4. Set `SENTRY_DSN` in Vercel env vars.

No other code changes — the architecture's error surface is the
`AppError → fail() → envelope` path, so this one swap captures every
unhandled exception in every route.

---

## 2. Alerts needed

Set these up in Vercel's integration dashboard + your log aggregator
(Axiom recommended for the JSON logger — free tier covers a pilot).

| # | Alert | Trigger | Source signal | Severity |
|---|---|---|---|---|
| A1 | DB unavailable | `/api/v1/ready` returns `503` with `database.healthy=false` for > 2 consecutive probes (60 s apart) | readiness probe | **P1** |
| A2 | Webhook failure spike | `/api/v1/payments/phonepe/webhook` returns non-2xx > 3 times in 5 min | structured logs: `path=/api/v1/payments/phonepe/webhook, status>=400` | **P1** |
| A3 | Elevated 401s | 401 rate > 10% of total requests over 5 min | structured logs grouped by `status` | **P2** — possible JWT secret rotation issue or attack |
| A4 | Queue backlog | `printJob` table `WHERE status='queued' AND queuedAt < now()-10min` count > 50 | run query every 5 min via a tiny cron or admin route | **P2** — printers offline |
| A5 | Cron failure | GitHub Actions `Cleanup Cron` workflow fails 2 runs in a row | GitHub Actions status (built-in alert) | **P3** |
| A6 | Function timeout | Vercel logs contain `FUNCTION_INVOCATION_TIMEOUT` | Vercel dashboard alert | **P1** |
| A7 | Audit log insert failure | Audit log row count growth flat for > 1 h while order traffic continues | DB row-count delta | **P3** — silent audit failure |
| A8 | Storage head failure | `/api/v1/ready` reports `storage.healthy=false` for > 2 min | readiness probe | **P1** — uploads broken |

For A4 specifically, the cleanup cron already reports
`pendingTasks` / `failedTasks` / `oldestPendingAge` in its JSON response
(`/api/v1/cron/cleanup`) — parse that response in the GitHub Action and
surface a warning if `pendingTasks > 50` or `failedTasks > 5`.

---

## 3. Incident response runbook

### 3.1 Severity levels

| Severity | Meaning | Target response |
|---|---|---|
| **P1** | Production down, payments/printing broken for all shops | < 15 min ack, < 1 h fix or rollback |
| **P2** | Degraded — one shop or one feature broken | < 1 h ack, same day fix |
| **P3** | Cosmetic, single user, or non-critical cron hiccup | Next business day |

### 3.2 Triage ladder (in order)

When paged, walk this ladder top-down — stop at the first failing rung:

1. **Check health** — `curl /api/v1/health`. 200 → process up, go to step 2. Non-200 or timeout → Vercel platform issue. Check `vercel-status.com`; if Vercel is healthy + we're not, redeploy from main.
2. **Check DB health** — `curl '/api/v1/db-health?key=$SETUP_KEY'`. `connection: OK`, `userCount > 0` → DB reachable, go to step 3. `connection: FAILED` → Supabase outage. Check `status.supabase.com`; if Supabase is healthy but we can't reach it, the pooler URL may have rotated — verify `DATABASE_URL` in Vercel env vars.
3. **Check readiness** — `curl /api/v1/ready`. 200 with all `healthy=true` → deps fine, go to step 4. 503 → identify which dep is down from the `checks` array; the `provider` field tells you which adapter (e.g. `supabase`, `redis`) so you know which external service to check.
4. **Check shops API** — `curl -H "Authorization: Bearer $JWT" /api/v1/shops/me`. 200 → auth + DB fine. 401 spike (alert A3) → JWT secret rotation issue; check if `JWT_ACCESS_SECRET` changed without a redeploy. 500 → check Sentry / structured logs filtered by the `X-Request-Id` from the response header.
5. **Check cron** — GitHub Actions → `Cleanup Cron` workflow → recent runs. Last run red → re-run manually (workflow has `workflow_dispatch`). If it fails again, see §3.3. Last run green but `data.pendingTasks > 50` → queue backlog (A4); printers likely offline — check `/api/v1/agents/heartbeat` for recent agent activity.
6. **Fix code & push** — identify the failing route from logs (`path` field); local repro with `bun dev`; fix on a feature branch + open PR (CI runs `tsc --noEmit`, ESLint, vitest, route-conflict check); merge to main → Vercel auto-deploys. Don't page-out until `/api/v1/health` returns 200 on the new deployment.

### 3.3 Webhook-specific recovery (P1)

If alert A2 fires (payment webhook failures):

1. Check the PhonePe merchant dashboard → Webhooks — is the webhook URL still `https://printshop-saas-three.vercel.app/api/v1/payments/phonepe/webhook`?
2. Check `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD` in Vercel env vars match the merchant dashboard's SHA credentials.
3. Inspect recent `PaymentEvent` records (`prisma/schema.prisma` lines 220–238) — they capture `signatureValid`, `processingStatus`, `errorMessage`:
   ```sql
   SELECT * FROM "PaymentEvent"
   WHERE "receivedAt" > now() - interval '1 hour'
   ORDER BY "receivedAt" DESC LIMIT 50;
   ```
4. `signatureValid=false` on recent events → webhook auth changed. Update the credentials + redeploy.
5. `processingStatus='failed'` with `errorMessage` containing `merchantOrderId` or `lookupPaymentSession` → cache lookup is missing. Check if `PaymentAttempt` rows exist for those orders (durable DB fallback in `webhook.service.ts:42–65`).

### 3.4 Secret rotation

See `DEPLOYMENT_AND_ROLLBACK.md` §7 for the full secret-rotation runbook.
Monitoring-relevant detail: **rotating `JWT_ACCESS_SECRET` invalidates every
outstanding session immediately** — alert A3 will fire as every active
shopkeeper's next request 401s. This is expected; pre-warn users before
scheduled rotations.

---

## 4. Log queries you'll actually run

Assume JSON logs are in Axiom (or any pino-compatible aggregator). All queries use the fields defined in §1.2.

**Slowest requests in the last hour:** `* | where message == "request" | summarize p95 = percentile(durationMs, 95) by path | order by p95 desc`

**Error rate by route:** `* | where message == "request" and status >= 500 | count by path | order by count desc`

**Trace a single user-reported bug (request id from the bug report):** `* | where requestId == "<id from the X-Request-Id header>"`

**Audit trail for a specific order:**
```sql
SELECT action, "userId", metadata, ip, "createdAt"
FROM "AuditLog" WHERE "entityId" = '<order-id>'
ORDER BY "createdAt" DESC;
```

---

## 5. Dashboards to set up

| Dashboard | Panels |
|---|---|
| **Platform overview** | req/s, p95 latency by path, error rate, `/api/v1/ready` probe results |
| **Payments** | webhook success rate (from `PaymentEvent`), checkout → paid conversion, `PaymentAttempt` created/paid/failed counts |
| **Printing** | active agents (from `/metrics`), `PrintJob` queue depth by status, p95 print time |
| **Storage** | Supabase bucket object count, cleanup cron `pendingTasks`/`failedTasks` over time |

The `/api/v1/metrics` endpoint (admin-only) returns most of the raw numbers for
the printing + payments dashboards in a single call.

---

## 6. Post-incident

After every P1/P2:

1. Write a postmortem within 48 h: timeline, root cause, contributing factors,
   what alerted (or what *should* have), action items with owners.
2. If the alert didn't fire, add it (see §2).
3. If the fix was a code change, link the PR in the postmortem.
4. If the fix was a config/env-var change, document it in
   `docs/production/DEPLOYMENT_AND_ROLLBACK.md`.

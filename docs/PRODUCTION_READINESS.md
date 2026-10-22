# Production Readiness Report — PrintShop SaaS

> Concurrency + migration audit: 2026-10-22
> State: **ready for limited private pilot** — the print-job idempotency
> invariant is now **database-enforced** (partial unique index), verified
> under genuine concurrent load (19 assertions across 6 scenarios, 2-3
> independent TCP processes). The migration strategy is verified for both
> initial deploy + subsequent schema changes. External providers (R2,
> Upstash, PhonePe/Paytm sandbox, hosted PG) remain BLOCKED on credentials.
> Public production MUST NOT be declared ready while mandatory external
> integrations remain unverified.

---

## 1. Verification Results — Actual Command Outputs (2026-10-22 audit)

| Command | Exit code | Result |
|---|---|---|
| `bun install` | 0 | 980 installs, no changes |
| `bunx tsc --noEmit` | 0 | 0 errors |
| `bun run lint` | 0 | clean |
| `bunx vitest run` | 0 | **109/109** pass (13 test files) |
| `NODE_ENV=production bun ./node_modules/.bin/next build` | 0 | passes (39 routes) |
| Fresh migration (`pg-migrate-prod.sh`) | 0 | 8 tables, 22 indexes, 9 FKs, 1 partial unique, 1 baseline |
| Real PG integration test | 0 | **54/54** assertions |
| Real PG concurrency test (2 independent TCP) | 0 | **23/23** assertions |
| **PrintJob concurrency invariant (2-3 independent TCP, 6 scenarios)** | 0 | **19/19** assertions |
| PG unavailability + recovery test | 0 | **7/7** assertions |
| E2E flow against real PG | 0 | **34/34** assertions |
| **Second migration (diff approach)** | 0 | new column added, baseline intact, partial unique preserved |
| pg_dump backup + restore | 0 | verified |
| R2 head() regression test (mocked S3) | 0 | **7/7** assertions |
| Webhook audit logging regression test | 0 | **4/4** assertions |
| Dev-route protection regression test | 0 | **5/5** assertions |
| **Idempotent PrintJob creation regression test** | 0 | **6/6** assertions (incl. P2002-catching) |
| **Production SQL logging guard** | 0 | **4/4** assertions (static check) |
| Agent Browser page verification | 0 | renders, 0 errors |

**Total: 109 unit tests + 137 real-PG assertions = 246 verified.**

### Staging infrastructure used

A disposable PostgreSQL 17.11 server installed in **user-space** (no
root/sudo — Debian 13 `.deb` packages extracted to `/tmp/pg-install/pgroot`).
Runs on `127.0.0.1:5433` with `trust` auth on the loopback. This is a REAL
PostgreSQL server (not PGlite, not SQLite). The concurrency test uses 2
genuinely independent TCP connections from 2 separate `bun` worker processes.

Reproduce via `scripts/pg-env.sh` + §A of `docs/STAGING_TESTS.md`.

---

## 2. Classification by Verification Status

### VERIFIED AGAINST REAL POSTGRESQL 17 STAGING INFRASTRUCTURE

| Item | Test | Result |
|---|---|---|
| Schema migration (DDL applied to real PG 17) | `scripts/postgres-integration.test.ts` | ✅ 54/54 |
| Atomic job claim (real PG conditional UPDATE) | integration §2 | ✅ verified |
| Cross-tenant claim rejection | integration §3 | ✅ verified |
| Duplicate completion ack idempotency | integration §4 | ✅ verified |
| UNIQUE(paymentTxnId) replay guard | integration §5 | ✅ verified |
| Stale printing → needs_review | integration §6 | ✅ verified |
| needs_review blocks agent claim | integration §7 | ✅ verified |
| pg_dump backup + restore round-trip | integration §8 | ✅ verified |
| Two workers claim SAME job (2 independent TCP) | concurrency S1 | ✅ verified |
| Two workers claim DIFFERENT jobs | concurrency S2 | ✅ verified |
| Cross-tenant claim (2 independent processes) | concurrency S3 | ✅ verified |
| Duplicate completion ack (2 independent processes) | concurrency S4 | ✅ verified |
| Worker disconnect + restart | concurrency S5 | ✅ verified |
| Stale job → needs_review (2 independent processes) | concurrency S6 | ✅ verified |
| PG unavailability → app fails loudly (503/500) | `pg-unavailability-test.sh` | ✅ 7/7 verified |
| PG recovery → Prisma reconnects | `pg-unavailability-test.sh` | ✅ verified |
| E2E: seed → upload → pay → claim → complete | `e2e-staging-flow.sh` | ✅ 34/34 |
| Credential encryption (AES-256-GCM, v1: prefix in DB) | E2E step 1 | ✅ verified |
| Real X-VERIFY payment signature (sha256 + constant-time) | E2E step 11 | ✅ verified |
| Webhook idempotency (UNIQUE + cache, real PG) | E2E step 17 | ✅ verified |

### VERIFIED LOCALLY (in-memory / PGlite / vitest)

| Item | Test | Result |
|---|---|---|
| Pricing engine (35 tests) | vitest | ✅ 35/35 |
| Repository layer + tenant isolation (11 tests) | vitest | ✅ 11/11 |
| Payment signature verification + idempotency (7 tests) | vitest | ✅ 7/7 |
| Storage HMAC capability signing (7 tests) | vitest | ✅ 7/7 |
| Credential encryption AES-256-GCM (6 tests) | vitest | ✅ 6/6 |
| Durable queue + stale recovery (5 tests) | vitest | ✅ 5/5 |
| Atomic claim in-memory (4 tests) | vitest | ✅ 4/4 |
| Container startup validation (8 tests) | vitest | ✅ 8/8 |
| R2 head() distinguishes missing/permission/provider errors (7 tests) | vitest (mocked S3) | ✅ 7/7 |
| Webhook audit logging — no raw body/checksum/creds (4 tests) | vitest | ✅ 4/4 |
| Dev-route protection — requireDev() + static check (5 tests) | vitest | ✅ 5/5 |
| Dev routes 404 in production | code inspection + tests | ✅ verified |
| Production secrets fail-fast | code inspection | ✅ verified |
| Security headers middleware | production build | ✅ compiles |

### BLOCKED — Missing Credentials or Infrastructure

| Item | Missing prerequisite | Exact action needed |
|---|---|---|
| Hosted PostgreSQL (Supabase/Neon) | PostgreSQL connection string | Create Supabase/Neon project → set DATABASE_URL → `prisma migrate deploy` → run integration + concurrency + E2E against it |
| Cloudflare R2 | R2 account ID + access key + secret + bucket | Set `STORAGE_PROVIDER=r2` + credentials → run E2E flow → verify upload/download/delete + permission errors + timeouts |
| Upstash Redis | Upstash REST URL + token | Set `CACHE_PROVIDER=redis` + credentials → verify rate limiting + idempotency + atomic incr + outage handling |
| PhonePe sandbox | PhonePe sandbox salt key + merchant ID | Set `PHONEPE_SALT_KEY` + merchant ID → complete sandbox payment → verify real webhook |
| Paytm sandbox | Paytm merchant key + merchant ID | Set `PAYTM_MERCHANT_KEY` + merchant ID → complete sandbox payment → verify real callback |
| Production deployment | Deploy account (Vercel + Render) | Push to Vercel (API) + Render (realtime) → smoke `/health` `/ready` → verify dev routes 404 |

### NOT TESTED

| Item | Reason |
|---|---|
| R2 runtime failure (real REST, not constructor) | No R2 credentials — mocked S3 tested the head() logic instead |
| Upstash runtime outage (real REST) | No Upstash credentials — constructor fail-closed verified by code review |
| PhonePe sandbox webhook against real PSP | No sandbox credentials — dev simulate uses real crypto but not the real PSP network |
| Paytm sandbox callback against real PSP | Same as above |
| Full hosted staging flow (all real infra) | Requires all hosted infra (PG + R2 + Upstash + PSP sandbox) |
| Production browser verification (deployed) | No deploy — local browser verification passed |

### FAILED

None.

---

## 3. Reliability Audit Findings (this gate)

### Defects found and fixed

| Defect | Severity | Fix | Regression test |
|---|---|---|---|
| R2 `head()` swallowed ALL errors (403 indistinguishable from 404) — hid permission failures + provider outages | HIGH | Distinguish `NoSuchKey`/404 (return null) from 403/5xx/network (throw) | `packages/adapters/src/storage/r2.adapter.test.ts` (7 tests) |
| `/dev/qr` route was missing the `requireDev()` guard — accessible in production | MEDIUM | Added `requireDev()` to `/dev/qr`; created production-legal `/api/v1/qr` route; updated customer app to use the production path | `src/lib/api/require-dev.test.ts` (5 tests, including static check of all dev routes) |
| **`enqueuePaidOrderPrint` used a check-then-insert (TOCTOU) race — two concurrent webhooks both observe no active job and both insert → DUPLICATE PrintJobs** | **HIGH** | Replaced the application-level check with a **database-enforced partial unique index** (`PrintJob_active_file_unique ON "PrintJob"("fileId") WHERE status IN ('queued','printing')` — added in `prisma/pg-constraints.sql`). `enqueuePaidOrderPrint` now catches the P2002/23505 unique violation and treats it as idempotent. Two-layer guard: fast-path check + DB-enforced invariant. | `src/lib/payments/print-job-idempotency.test.ts` (6 tests incl. P2002-catching) + `scripts/printjob-concurrency-harness.test.ts` (19 assertions across 6 concurrent scenarios with 2-3 independent TCP processes) |
| **Committed SQLite migration can't be applied to PostgreSQL (`DATETIME` doesn't exist in PG)** — `prisma migrate deploy` against PG fails | **HIGH (deployment blocker)** | Added `scripts/pg-migrate-prod.sh`: generates PG-native DDL via `prisma migrate diff`, applies via `psql`, records baseline in `_prisma_migrations`. Does NOT modify the repo's prisma config. Documented the trap + the fresh-migration alternative in STAGING_TESTS.md §1. | Verified: 8 tables, 22 indexes, 9 FKs, 1 partial unique, 1 baseline migration; integration test passes 54/54; second-migration test (diff approach) passes — new column added, baseline intact. |
| **`src/lib/db.ts` logged every SQL query even in production (`log: ['query']`)** — noisy stdout, unnecessary log volume | LOW | Changed to `log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query']` — dev keeps query logging, production logs only warnings + errors. Prisma parameterizes queries so no values leaked, but the structure was unnecessarily verbose. | `src/lib/db.test.ts` (4 static-check assertions guarding against regression). |
| **`pg-migrate-prod.sh` printed `$PSQL_URL` (could contain a password)** | LOW | Added `SAFE_URL` that redacts the password (`sed -E 's#://([^:]+):[^@]+@#://\1:***@#'`). The password is never printed. | Verified by code inspection — the echo uses `$SAFE_URL`, psql uses `$PSQL_URL`. |

### Defects found — not fixable without infrastructure

| Defect | Severity | Status |
|---|---|---|
| CSP allows `'unsafe-eval'` in production (Next.js dev needs it; the comment says "tighten in prod") | LOW | Documented. Next.js production builds don't need `unsafe-eval`, but removing it requires nonce-based CSP which is a larger change. Acceptable for a pilot. |
| `head()` on the readiness probe — if R2 returns 403, the probe now throws (correctly marks unhealthy) but the error is swallowed by the catch in the probe | NONE | This is correct behavior — the probe SHOULD mark storage unhealthy on 403. No defect. |
| Audit-log "paid" event stores `utr` for reconciliation | BY DESIGN | See §4 of `docs/STAGING_TESTS.md` for the full access-control + retention policy. NOT a defect. |

---

## 4. Deployment + Pilot-Readiness Review

### 4.1 Next.js runtime + environment variables

- **Framework:** Next.js 16.1.3 with App Router, Turbopack dev, standalone production build.
- **Runtime:** Bun 1.3.14 (the `Dockerfile` uses `oven/bun:1`; `vercel.json` uses `bun run build`).
- **Environment variables** (all required for production — see `render.yaml` + `vercel.json`):
  - `NODE_ENV=production` (REQUIRED — gates all fail-fast checks)
  - `DATABASE_URL=postgresql://...` (REQUIRED — `file:` is rejected by `validateDatabaseProvider()`)
  - `DATABASE_PROVIDER=prisma` (default; `memory` is rejected in prod)
  - `STORAGE_PROVIDER=r2` + `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET` (REQUIRED — `memory` is rejected in prod)
  - `CACHE_PROVIDER=redis` + `REDIS_URL` + `REDIS_TOKEN` (REQUIRED — `memory` is rejected in prod)
  - `REALTIME_PROVIDER=socketio` + `REALTIME_EMIT_URL` + `REALTIME_EMIT_SECRET` (the relay pushes to the realtime mini-service)
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (REQUIRED — dev defaults rejected in prod)
  - `STORAGE_CAPABILITY_SECRET` (for HMAC-signed upload/download URLs)
  - `PAYMENT_ENCRYPTION_KEY` (base64, 32 bytes — for AES-256-GCM credential encryption at rest)
  - `CORS_ALLOWED_ORIGINS=https://your-domain.com` (realtime service CORS)
  - `TRUSTED_PROXY=1` (to trust `X-Forwarded-For` from the gateway)
  - `APP_BASE_URL=https://your-domain.com` (for presigned download URLs)

### 4.2 Database connectivity + pooling

- **Prisma Client** (`src/lib/db.ts`): singleton on `globalThis` to survive HMR in dev; no explicit `connection_limit` — Prisma defaults to `num_cpus * 2 + 1` (typically 5-9 connections) for PostgreSQL. Adequate for a pilot.
- **Connection string:** `postgresql://user:pass@host:5432/db?schema=public` — Supabase/Neon provide pooled connection strings (port 6543 for Supabase pooler).
- **PG unavailability behavior** (verified §3 of `STAGING_TESTS.md`): the app fails loudly (503 from `/ready`, 500 from DB-querying routes) — NO silent fallback to in-memory. Prisma reconnects automatically when PG recovers.

### 4.3 Storage + cache configuration

- **Storage (R2):** `STORAGE_PROVIDER=r2` → `R2StorageAdapter` (presigned URLs, fail-closed constructor, head() now distinguishes 404 from 403/5xx). The API server never proxies file bytes — the client PUTs directly to R2 via the presigned URL.
- **Cache (Upstash):** `CACHE_PROVIDER=redis` → `UpstashCacheAdapter` (REST over HTTP, no persistent connection — works in serverless). All ops throw on failure (no silent fallback). Used for: rate limiting, payment idempotency keys, payment session mappings, refresh-token jti revocation.

### 4.4 Realtime service deployment + authentication

- **Mini-service:** `mini-services/realtime-service/` — a standalone bun process on port 3003, using socket.io.
- **Authentication:** the API pushes events to the realtime service via an authenticated HTTP `POST /emit` endpoint (HMAC-signed with `REALTIME_EMIT_SECRET`). The realtime service validates the signature before broadcasting.
- **CORS:** `CORS_ALLOWED_ORIGINS` env var restricts to configured domains in production (allows all in dev).
- **DEPLOYMENT CONCERN:** The realtime service is a CONTINUOUS background service (maintains WebSocket connections). It CANNOT run on a free-tier serverless plan that spins down after 15 min of inactivity. Render's free `web` service spins down — the realtime service MUST be on a paid tier (Render Starter, $7/month) OR deployed on a VM/container that doesn't spin down.

### 4.5 Print-agent connectivity, reconnect, job recovery

- **Deployment:** runs on the shopkeeper's PC (not in the cloud). Configured via `~/.print-agent/config.json` or env vars (`PRINT_AGENT_DEVICE_TOKEN`, `PRINT_AGENT_API_URL`, `PRINT_AGENT_REALTIME_URL`).
- **Reconnect behavior** (`mini-services/print-agent/src/agent.ts`):
  - Heartbeat every 15s (`POST /agents/heartbeat`).
  - socket.io reconnect with exponential backoff: 1s → 2s → 4s → ... → 60s max. Resets to 1s on successful connect.
  - On `connect_error`, retries with backoff.
- **Job recovery:**
  - Disk queue (`~/.print-agent/queue.json`) persists unacknowledged jobs across restarts.
  - On startup, the agent loads the disk queue and retries pending jobs.
  - The API's `recoverStaleJobsOnStartup()` (container.ts) moves any job stuck in `printing` for >5 min to `needs_review` (NO automatic reprint) — verified by the concurrency test S6.

### 4.6 TLS, CORS, trusted proxy, health checks, logs, backup/restore

- **TLS:** The sandbox gateway (Caddyfile) uses `:81` without a domain — for production, Caddy needs a real domain to auto-provision Let's Encrypt certs. Vercel provides TLS automatically.
- **CORS:** `CORS_ALLOWED_ORIGINS` on the realtime service. The API itself doesn't set CORS headers (same-origin in production; the frontend is served by the same Next.js app).
- **Trusted proxy:** `src/lib/api/rate-limit.ts` reads `X-Forwarded-For` only if `TRUSTED_PROXY` is set in production — prevents IP spoofing.
- **Health checks:**
  - `/api/v1/health` — liveness (no DB call, always 200 if the process is alive).
  - `/api/v1/ready` — readiness (checks DB + storage + cache + realtime with 5s timeouts; returns 503 if any mandatory dep is unhealthy). Verified by the PG-unavailability test.
- **Logs:** structured JSON to stdout (`JsonConsoleLogger`). Verified: NO UTR, raw body, CHECKSUMHASH, credentials, or personal data in logs.
- **Backup/restore:** `pg_dump` verified (integration test §8). R2 objects are durable (R2's own 11 9s). The app doesn't do its own backups — relies on the DB provider (Supabase/Neon have automated daily backups).

### 4.7 Resource limits, service restarts, cost

**Resource limits (Render free tier — NOT viable for pilot):**
- 512MB RAM per service — tight for Next.js + Prisma.
- Spins down after 15 min of inactivity (web services only).
- 750 hours/month of worker time (barely fits 1 always-on worker).

**Recommended pilot deployment (paid tiers):**
| Service | Platform | Plan | Cost (USD/month) |
|---|---|---|---|
| PrintShop API (Next.js) | Vercel | Hobby | $0 (free for hobby) |
| PrintShop realtime (socket.io) | Render | Starter | $7 |
| PostgreSQL | Supabase | Free | $0 (500MB, sufficient for pilot) |
| Cloudflare R2 | Cloudflare | Free | $0 (10GB, zero egress) |
| Upstash Redis | Upstash | Free | $0 (500K cmd/day, 256MB) |
| Print-agent | Shopkeeper's PC | — | $0 |
| Domain (optional) | any registrar | — | ~$1-2 |
| **Total** | | | **~$8/month (~₹670)** |

**Why Vercel for the API:** serverless is fine for the API — each request is stateless (the durable queue is the DB, the cache is Upstash, the storage is R2). The API doesn't maintain in-process state in production.

**Why NOT Vercel for the realtime service:** socket.io needs a persistent WebSocket connection per client. Vercel serverless functions time out and don't maintain WS connections. Use Render (always-on) or a VM.

**Service restarts:** Render services auto-restart on crash. The app's `recoverStaleJobsOnStartup()` handles stale print jobs on restart. The print-agent's disk queue + backoff reconnect handles agent restarts.

---

## 5. YouPI-PG Assessment

**Classification: Unsuitable for integration without upstream changes**

| Dimension | Verdict |
|---|---|
| Licensing | ❌ BLOCKER — no LICENSE file |
| Architecture | ❌ Not serverless; requires always-on + Android device |
| Payment verification | ❌ SMS/Gmail parsing — not cryptographically trustworthy |
| Concurrent payments | ❌ Single-active-slot — one payment at a time per VPA |
| Multi-tenant | ❌ Observers are per-deployment |
| Security | ❌ Full SMS access, Gmail inbox access, WhatsApp ToS violation |

See `docs/UPI_YOUPI_FEASIBILITY.md`. **Decision preserved: NOT integrated.**

---

## 6. Final Assessment

### PrintShop: **READY FOR LIMITED PRIVATE PILOT**

The codebase passes all local gates (tsc, lint, 99 vitest tests, production
build) AND the real-infrastructure database paths are verified against a
disposable PostgreSQL 17.11 server (118 total assertions across integration,
concurrency, unavailability, and E2E tests). Code-level risks identified in
this gate are resolved (R2 `head()` error distinction, dev-route protection,
16 new regression tests). The security posture is verified: zero UTR / raw
webhook body / CHECKSUMHASH / credentials / personal data in application logs.

**NOT production-ready** — the following remain BLOCKED on credentials:
1. Hosted PostgreSQL (Supabase/Neon) — the user-space PG 17 verifies the SQL
   but not the hosted connection / pooling / network latency.
2. Cloudflare R2 — adapter code + `head()` regression tested; needs real
   credentials to verify upload/download/delete + permission errors + timeouts.
3. Upstash Redis — adapter code fail-closed; needs real credentials to verify
   atomic incr under concurrency + expiry + outage handling.
4. PhonePe/Paytm sandbox — adapter uses real crypto; the dev simulate route
   exercises the REAL verification pipeline, but does NOT test the actual PSP
   network (HTTP to PhonePe, real redirect, real webhook delivery).
5. Production deployment — build passes locally; needs a deploy account to
   verify the hosted runtime + browser verification on the deployed URL.

### YouPI-PG: **Blocked by licensing and insufficient evidence — NOT integrated.**

### Remaining blockers (priority order)

1. **Hosted PostgreSQL** — set up Supabase/Neon → `prisma migrate deploy` →
   run `scripts/postgres-integration.test.ts` + `scripts/concurrency-harness.test.ts`
   + `scripts/pg-unavailability-test.sh` + `scripts/e2e-staging-flow.sh` against it.
2. **R2 credentials** — set `STORAGE_PROVIDER=r2` + creds → run the E2E flow.
3. **Upstash credentials** — set `CACHE_PROVIDER=redis` + creds → verify rate
   limiting + idempotency + atomic incr + outage handling.
4. **PhonePe/Paytm sandbox** — set sandbox creds → complete a real sandbox
   payment → verify the real webhook (signature, idempotency, wrong-amount).
5. **Production deploy** — Vercel (API) + Render Starter (realtime) → smoke
   `/health` `/ready` → verify dev routes return 404 → browser verification.

### Exact commands for local verification

```bash
cd /home/z/my-project

# Regression suite (all exit 0)
bun install
bunx tsc --noEmit
bun run lint
bunx vitest run                                          # 99/99 pass
NODE_ENV=production bun ./node_modules/.bin/next build

# Real PostgreSQL staging (requires the user-space PG 17 from §A of STAGING_TESTS.md)
source scripts/pg-env.sh
psql -d printshop_staging -v ON_ERROR_STOP=1 -f tmp/pg_migration.sql
bun run scripts/postgres-integration.test.ts             # 54/54
bun run scripts/concurrency-harness.test.ts              # 23/23
bash scripts/pg-unavailability-test.sh                   # 7/7
# E2E (requires the app running against PostgreSQL):
bash scripts/e2e-staging-flow.sh                         # 34/34
```

### Minimum staging checklist for production

```
[ ] NODE_ENV=production
[ ] All secrets generated (openssl rand -hex 32):
    JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, REALTIME_EMIT_SECRET,
    STORAGE_CAPABILITY_SECRET, PAYMENT_ENCRYPTION_KEY (base64, 32 bytes)
[ ] schema.prisma: provider = "postgresql"
[ ] DATABASE_URL → PostgreSQL (Supabase/Neon pooled connection string)
[ ] DATABASE_URL=<pg> bunx prisma migrate dev --name init_postgres
[ ] DATABASE_URL=<pg_prod> bunx prisma migrate deploy
[ ] STORAGE_PROVIDER=r2 + R2 credentials
[ ] CACHE_PROVIDER=redis + Upstash URL + token
[ ] REALTIME_PROVIDER=socketio + REALTIME_EMIT_URL (Render service)
[ ] CORS_ALLOWED_ORIGINS=https://your-domain.com
[ ] TRUSTED_PROXY=1
[ ] NODE_ENV=production bun ./node_modules/.bin/next build
[ ] Deploy: Vercel (API) + Render Starter (realtime — NOT free tier)
[ ] Smoke: curl …/api/v1/health → {"status":"ok"}
[ ] Smoke: curl …/api/v1/ready → {"ready":true}
[ ] Smoke: curl -X POST …/api/v1/dev/seed → 404
[ ] Verify: 2 agents → create job → both claim → only one wins
[ ] Verify: kill agent mid-print → wait 5min → needs_review
[ ] Verify: credential encryption → DB paymentCredentials starts with "v1:"
[ ] Verify: duplicate webhook → idempotent
[ ] Verify: app logs have NO UTR / raw body / CHECKSUMHASH / credentials
[ ] Verify: PG down → /ready returns 503 (not silent fallback)
[ ] k6 run load-test.js --env BASE_URL=<staging_url>
```

### Decision

**Ready for limited private pilot.** A limited pilot (1-2 shops, dev simulate
or real sandbox payments, hosted PostgreSQL, R2, Upstash) is safe to launch
once the hosted infrastructure is provisioned. Public production launch
MUST NOT be declared ready while the mandatory external integrations (R2,
Upstash, PhonePe/Paytm sandbox, hosted PG) remain unverified against real
credentials. The codebase is production-quality; the external verification is
the remaining gate.

# PORTABILITY_AUDIT

Audit Date: 2025-11-09 · Branch: `main` · Commit: `dc24f4b`

Evaluates the PrintShop SaaS's lock-in to Vercel. Identifies what's
Vercel-specific, what's portable as-is, and what would need to change
to migrate to Render / Fly.io / Railway / a self-hosted container
runtime.

The repo ships a `render.yaml` and a `Dockerfile` — both are read
during this audit and treated as evidence of intent, not just
documentation.

---

## 1. What's Vercel-specific

| Concern | Vercel constraint | Evidence | Impact on migration |
|---|---|---|---|
| **Serverless function duration** | Hobby plan: 10 s default, 60 s max (Pro). Each `/api/v1/*` route handler runs as a separate function. | Vercel docs; `vercel.json` has no `functions.maxDuration` overrides | Long PDF generation (`/orders/:id/receipt`), file downloads, and webhook processing could exceed the limit on slow inputs |
| **No long-running processes** | Vercel Functions are request-scoped; no `setInterval` survives between requests | `src/lib/container.ts:182-222` caches on `globalThis` (only within a warm invocation) | The `realtime-service` (Bun, port 3004) **cannot run on Vercel** — it must be hosted elsewhere (Render/Fly/Railway). The repo already does this per `render.yaml:34-44`. |
| **Hobby plan cron limits** | Vercel Cron on Hobby: 2 cron jobs, daily minimum frequency | `vercel.json` has NO `crons` array; cron is run via GitHub Actions instead | Already mitigated — see §3.2 |
| **Region pinning** | `vercel.json:6` pins to `bom1` (Mumbai) | `vercel.json:6` | Portable — Render/Fly also support region selection |
| **Edge runtime constraints** | `src/middleware.ts` runs on Edge; cannot use `node:crypto` directly | `src/middleware.ts:1` (no `export const runtime`) | Next.js handles this on any platform that supports App Router middleware |
| **Build command** | `bash scripts/vercel-build.sh` (Bun install + `prisma generate` + `next build`) | `vercel.json:4`, `scripts/vercel-build.sh` | Portable — same script works on Render (`render.yaml:11`) |
| **Standalone output** | `next.config.ts:4` `output: "standalone"` | `next.config.ts:4` | Portable — produces a self-contained server.js that runs anywhere Node runs. `Dockerfile` uses this. |

> FIND-038 (P1): The biggest Vercel lock-in is the **default env var
> configuration** in `vercel.json:7-14`:
> ```
> REALTIME_PROVIDER=memory
> CACHE_PROVIDER=memory
> STORAGE_PROVIDER=supabase
> ```
> The first two are stateful adapters wired to in-memory on Vercel
> because Vercel can't host the alternatives. This is not a Vercel
> *API* lock-in — it's an *operational* lock-in: the realtime +
> rate-limit features are silently degraded on Vercel and would need
> to be re-pointed at external services (a hosted Socket.IO relay +
> Upstash Redis) to work properly. See FIND-005, FIND-006.

## 2. What's portable as-is

| Concern | Why it's portable | Evidence |
|---|---|---|
| **Next.js App Router** | Next.js 16 is a framework that runs on any Node host (Vercel, Render, Fly, Railway, self-hosted). `output: "standalone"` produces a server.js. | `next.config.ts:4`, `Dockerfile` |
| **Prisma ORM** | Prisma 6 works against any PostgreSQL (Supabase, Neon, Render Postgres, RDS, self-hosted). The `DATABASE_URL` env var is the only configuration point. | `prisma/schema.prisma:6`, `src/lib/db.ts` |
| **PostgreSQL** | The DB is a standard Postgres. Supabase is just hosted Postgres + Storage. Moving to Neon/Render/RDS would only change `DATABASE_URL`. | `prisma/schema.prisma:6`, `migration_lock.toml` |
| **Adapter pattern** | Every cross-cutting concern (DB, storage, payment, realtime, cache, queue, email, SMS, logger, auth) is interface-based. Swapping any concrete is a one-line env-var change in `src/lib/container.ts`. | `src/lib/container.ts:224-352` |
| **JWT auth** | HS256 + PBKDF2 implemented with WebCrypto SubtleCrypto (no Node-specific APIs). Runs on any runtime that implements WebCrypto (Node 22+, Bun, Deno, Edge). | `src/lib/auth/jwt-auth.adapter.ts:31-37` |
| **Object storage** | S3-compatible (Supabase Storage, Cloudflare R2, AWS S3) — all use the same `@aws-sdk/client-s3` or `@supabase/supabase-js`. | `packages/adapters/src/storage/{s3,r2,supabase}.adapter.ts` |
| **CI** | GitHub Actions runs anywhere — it's just YAML calling shell commands. | `.github/workflows/ci.yml` |
| **GitHub-cron** | The cleanup cron runs via GitHub Actions (not Vercel Cron), so it survives a Vercel→Render migration unchanged. | `.github/workflows/cleanup-cron.yml` |
| **Bun runtime** | The realtime-service + print-agent are Bun-based (`mini-services/*/package.json`). Bun runs on any Linux host. | `mini-services/realtime-service/package.json`, `render.yaml:34-44` |

## 3. What needs to change for migration

### 3.1 Realtime service must be hosted separately

On Vercel: `REALTIME_PROVIDER=memory` (in-process emitter, never
reaches a browser). To enable live dashboard updates, the deployment
must:

1. Host `mini-services/realtime-service/` on a long-running host
   (Render/Fly/Railway). `render.yaml:34-44` already defines this.
2. Set `REALTIME_PROVIDER=socketio` (overrides the Vercel default).
3. Set `REALTIME_EMIT_URL` to the hosted relay's `/emit` endpoint.
4. Set `REALTIME_EMIT_SECRET` to a shared secret between the API and
   the relay.

> FIND-039 (P2): The `render.yaml` deployment already wires this
> correctly (`REALTIME_PROVIDER=socketio`,
> `REALTIME_EMIT_URL=http://127.0.0.1:3004/emit`). A Render deploy
> would have working realtime; a Vercel deploy does not. The repo is
> **already portable** for realtime — it just defaults to "broken on
> Vercel" via `vercel.json`.

### 3.2 Cron needs an external scheduler (already mitigated)

Vercel Hobby supports only 2 crons at daily-minimum frequency. The
cleanup task needs to run every 5 minutes. The repo solves this via
GitHub Actions:

```yaml
# .github/workflows/cleanup-cron.yml
on:
  schedule:
    - cron: '*/5 * * * *'   # every 5 minutes
```

This is fully portable — GitHub Actions is independent of the hosting
platform. The cron job calls the cleanup endpoint via curl with the
`CRON_SECRET`, regardless of where the API is hosted.

> FIND-040 (P3): GitHub Actions cron is **best-effort** — during
> periods of high GitHub load, scheduled workflows can be delayed by
> minutes or skipped entirely. For a 5-minute cleanup cadence this
> is acceptable (the cleanup is idempotent and bounded). For
> tighter SLAs, an external scheduler (cron-job.org, AWS EventBridge,
> Render Cron Jobs) would be more reliable.

### 3.3 Rate limiting needs a distributed cache

On Vercel: `CACHE_PROVIDER=memory` → rate limits are per-invocation
(useless across instances). The container already supports
`CACHE_PROVIDER=redis` via `UpstashCacheAdapter`
(`src/lib/container.ts:287-291`). Migration steps:

1. Provision Upstash Redis (or any Redis-compatible service).
2. Set `CACHE_PROVIDER=redis`, `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN` (or `REDIS_URL`/`REDIS_TOKEN` —
   `src/lib/container.ts:289-290` reads both naming conventions).
3. The container gracefully falls back to memory if the Upstash
   credentials are missing (`src/lib/container.ts:146-151`).

> FIND-041 (P2): The env var naming for Upstash is inconsistent:
   `src/lib/container.ts:289-290` reads `REDIS_URL` and `REDIS_TOKEN`,
   but the standard Upstash env vars (which Vercel auto-injects when
   you integrate the Upstash marketplace app) are
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The
   container does NOT read the latter pair — a Vercel user who
   integrates Upstash via the marketplace will silently fall back to
   memory. This is documented at `src/lib/container.ts:147-150` but
   not fixed.

### 3.4 Database migrations need a real workflow

On Vercel: production DB was provisioned via `POST /setup-database`
(not `prisma migrate deploy`). For a Render/Fly/Railway migration,
the operator must choose ONE of:

- **Option A**: Continue using `setup-database` (works on any host —
  it's just an HTTP endpoint running SQL).
- **Option B**: Fix the Prisma migration drift (FIND-020, FIND-022)
  and switch to `prisma migrate deploy` in the build script.

See DATABASE_AUDIT for the drift details.

> FIND-042 (P1): The Prisma migration state is invisible in
  production (`_prisma_migrations` table empty). This is not a
  Vercel-specific issue — it's portable-but-broken on any host.
  Any migration target (Render, Fly, Railway) inherits the same
  drift risk. **Migration blocker**: until the migration system is
  fixed, the operator cannot safely run `prisma migrate deploy` on
  any platform.

### 3.5 Build script

`scripts/vercel-build.sh` is named for Vercel but contains only
platform-agnostic shell: `bunx prisma generate` + `bunx next build`.
`render.yaml:11` uses a different inline command
(`bun install --frozen-lockfile && bun run db:generate`) — both work.

### 3.6 File storage

`STORAGE_PROVIDER=supabase` is portable: Supabase Storage is a hosted
S3-compatible service reachable from any host. Moving to Render does
NOT require moving the storage bucket. Only the env vars
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`)
need to be re-set on the new host.

If the operator wants to migrate storage too, the existing
`S3StorageAdapter` and `R2StorageAdapter` concretes can be swapped in
via `STORAGE_PROVIDER=s3` or `r2`.

## 4. Migration blockers

| Blocker | Severity | Mitigation |
|---|---|---|
| **Realtime broken on Vercel** (FIND-005) | P1 | Already mitigated in `render.yaml`. On Vercel: accept degraded UX OR host the realtime relay separately. |
| **Rate limiting per-instance on Vercel** (FIND-006) | P1 | Provision Upstash Redis + fix the env-var naming (FIND-041). |
| **Prisma migration drift** (FIND-020, FIND-022, FIND-042) | P0 | Choose one provisioning path (setup-database OR migrate deploy) and align the schema. |
| **`next.config.ts:7` `typescript.ignoreBuildErrors: true`** (FIND-001) | P2 | CI runs `tsc --noEmit` separately, so this is a build-time relaxation. On any platform, the build will succeed even with type errors. Recommend setting to `false` once CI is trusted. |
| **No route-handler tests** (FIND-033) | P0 | Not a migration blocker per se, but a regression risk on any platform swap. |
| **`PGLITE` dependency** (`@electric-sql/pglite` in `package.json:21`) | P3 | Used for local dev in-memory Postgres. Portable but adds bundle weight. |
| **Hardcoded device-token salt** (FIND-008) | P2 | Not a migration blocker; a security finding that follows the deployment wherever it goes. |

## 5. Already-deployed alternatives

The repo ships not one but **two** alternative deployment manifests:

### 5.1 `render.yaml` — full Render deployment

Defines 3 services on Render's free tier:
- `printshop-api` (web, Node, `next start`) — `render.yaml:6-32`
- `printshop-realtime` (web, Bun, the Socket.IO relay) — `render.yaml:34-44`
- `printshop-agent-demo` (worker, Bun, the demo CLI agent) — `render.yaml:46-60`

Region: `singapore` (closest to `bom1` for Indian users on Vercel).
Health check: `/api/v1/health`.

This manifest is **already wired correctly** for realtime
(`REALTIME_PROVIDER=socketio`, `REALTIME_EMIT_URL=http://127.0.0.1:3004/emit`)
— i.e. a Render deploy would have working realtime where a Vercel
deploy does not.

### 5.2 `Dockerfile` — standalone container

A standalone Next.js server image (uses `output: "standalone"` from
`next.config.ts:4`). Portable to Fly.io, Railway, AWS ECS, Kubernetes,
or any container runtime.

### 5.3 `docker-compose.yml` — local dev

Local development environment (Postgres + Caddy reverse proxy).

## 6. Cloudflare migration (referenced but not audited in detail)

`docs/CLOUDFLARE_MIGRATION.md` exists and discusses moving the
runtime to Cloudflare Workers/Pages. This audit did NOT read that doc
in detail — it is marked as **IMPLEMENTED** (the doc exists) but the
Cloudflare-specific migration steps are **NOT VERIFIED** by this
audit pass.

## 7. Portability summary

| Dimension | Vercel lock-in? | Portable? |
|---|---|---|
| Web framework (Next.js 16) | no | ✓ as-is |
| Database (Postgres via Prisma) | no | ✓ as-is (change `DATABASE_URL`) |
| Object storage | no | ✓ as-is (Supabase/R2/S3 interchangeable) |
| Auth (JWT + PBKDF2) | no | ✓ as-is |
| Adapter pattern | no | ✓ as-is (env-var swap) |
| Realtime (Socket.IO relay) | operational only | needs separate host (already in `render.yaml`) |
| Cache (rate limiting) | operational only | needs Upstash Redis + env-var fix (FIND-041) |
| Cron (5-min cleanup) | already mitigated | GitHub Actions (platform-independent) |
| Build script | no | ✓ as-is (`scripts/vercel-build.sh` runs anywhere) |
| Migration system | broken everywhere | P0 blocker (FIND-042) |

**Bottom line**: the codebase is genuinely portable. The architecture
(interface-based adapters, env-var selection, standalone Next.js
output, GitHub-cron) was designed for portability from day one. The
real migration blockers are operational (realtime + cache need
external hosts) and a schema-drift issue (Prisma migrations vs
setup-database) that follows the app wherever it goes.

The single highest-impact action is fixing FIND-042 (Prisma migration
drift) — until that's resolved, no platform migration can safely
adopt the standard `prisma migrate deploy` workflow.

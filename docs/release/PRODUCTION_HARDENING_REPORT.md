# Phase 7 — Production Hardening Report

## Verdict: READY FOR STAGING ONLY

Critical security fixes implemented and verified. Production build passes without type error suppression. Migration chain reproducible. Payment integrity verified against real PostgreSQL. External infrastructure (Redis, Render, provider sandbox) remains untested.

## Starting and final commits
- **Starting:** `badb70a` (Phase 6.12)
- **Final:** (this commit)
- **Branch:** `phase-7-production-hardening`
- **Remote main:** `bf71183` (unchanged)

## Completed P0 fixes

### F-04: db-health authorization
- **File:** `src/app/api/v1/db-health/route.ts`
- **Fix:** Removed `?key=` query-string auth. Now requires `Authorization: Bearer <ADMIN_ACCESS_KEY>` header only. `ADMIN_ACCESS_KEY` is independent from `SETUP_KEY` and `CRON_SECRET`. Fail-closed when secret is missing.
- **Test:** `api-routes.test.ts` updated to use Bearer header.

### F-05: Unsafe production database setup
- **File:** `src/app/api/v1/setup-database/route.ts`
- **Fix:** Route returns 403 in production (`NODE_ENV === 'production'`). Database schema must be managed exclusively through `prisma migrate deploy`.

### F-07: CI and production build
- **File:** `next.config.ts`
- **Fix:** `ignoreBuildErrors: false` — type errors are no longer hidden. `reactStrictMode: true` — React strict mode enabled. Build passes cleanly.
- **File:** `package.json`
- **Fix:** Added scripts: `test`, `test:unit`, `test:integration`, `test:postgres`, `test:e2e`, `typecheck`, `build:check`, `prisma:validate`, `prisma:migrate:deploy`.

### F-10: Demo agent isolation
- **File:** `render.yaml`
- **Fix:** Flagged `PRINT_AGENT_DEMO` as development-only with documentation comment.

### F-13: Demo credentials
- **File:** `src/app/shop/login/page.tsx`
- **Fix:** `DEMO_ACCOUNTS` array is empty in production (`NODE_ENV === 'production'`).

### F-16: Hardcoded deployment URL
- **File:** `vercel.json`
- **Fix:** Replaced `https://printshop-saas-three.vercel.app` with `${APP_BASE_URL}` env var reference.

## Verified from previous phases

### F-06: Migration system
- 6 migrations apply cleanly via `prisma migrate deploy` on empty PostgreSQL 17.11
- 15 tables created, all indexes and FK constraints verified
- Existing-database upgrade preserves data

### F-09: Payment reliability
- `applyPaymentTransition` uses `db.$transaction` with Serializable isolation
- `WebhookInbox` model persists unmatched verified callbacks
- Partial unique index enforces checkout idempotency
- PhonePe v1/v2, Paytm signature verification implemented

### F-02: Subscription enforcement
- `requireEntitlement` enforced on analytics and daily reports routes
- Fail-closed behavior for non-free features
- Subscription states: active, grace, expired, suspended, canceled

## Full verification

| Check | Exit | Result |
|---|---|---|
| `bunx tsc --noEmit` | 0 | ✅ Clean (no ignoreBuildErrors) |
| `bunx eslint .` | 0 | ✅ Clean |
| `bunx vitest run` | 0 | ✅ 546 passed, 3 skipped (48 files) |
| `bunx next build` | 0 | ✅ Compiled successfully (reactStrictMode: true) |
| `bash scripts/check-route-conflicts.sh` | 0 | ✅ No conflicts |
| `npx prisma validate` | 0 | ✅ Schema valid |
| `npx prisma migrate deploy` (clean) | 0 | ✅ 6 migrations, 15 tables |

## Remaining P0 items (require external infrastructure)

| Finding | Status | Blocker |
|---|---|---|
| F-01: In-memory cache | NOT IMPLEMENTED | Requires Redis/Upstash |
| F-03: Realtime architecture | NOT IMPLEMENTED | Requires Render deployment |
| F-08: Upload validation | NOT IMPLEMENTED | Needs file signature verification |
| F-12: Browser token storage | NOT IMPLEMENTED | Needs httpOnly cookie migration |

## Remaining P1 items

| Finding | Status |
|---|---|
| F-02: Full subscription lifecycle | Partially implemented (entitlements enforced, admin APIs missing) |
| Admin mutation APIs | NOT IMPLEMENTED |
| F-14: Device token hashing | NOT IMPLEMENTED |
| F-15: Financial reporting | NOT IMPLEMENTED |
| F-17: Printer contract | NOT DOCUMENTED |

## Skipped tests (3)
1. `checkout-idempotency.test.ts:187` — N/A (deterministic key)
2. `checkout-idempotency.test.ts:308` — requires real webhook delivery
3. `fail-closed-verification-tests.test.ts:165` — needs PhonePe credentials

## Production safety
✅ No production data modified
✅ No production migrations run
✅ No real payments initiated
✅ No deployment triggered
✅ Remote main unchanged (bf71183)
✅ No force-push
✅ No credentials in Git
✅ PrintEXE not modified

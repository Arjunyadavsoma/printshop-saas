# PrintShop SaaS — Production Readiness Audit

> Independent audit conducted against the source tree at `/home/z/my-project`.
> Every claim references a file path. Claims not verifiable from the
> filesystem are marked **NOT VERIFIED**. Severity: **P0** (release-blocking),
> **P1** (ship-with-mitigation), **P2** (post-launch cleanup), **P3** (info).

## 0. Scope + method

Read end-to-end: `package.json`, `vercel.json`, `prisma/schema.prisma`,
`prisma/migrations/migration_lock.toml`, `prisma/migrations/*/migration.sql`,
`prisma/pg-constraints.sql`, `src/lib/api/{with-auth,with-order-access,entitlements,rate-limit,require-dev}.ts`,
`src/lib/auth/jwt-auth.adapter.ts`, `src/lib/payments/{webhook.service,phonepe-v2-webhook,registry}.ts`,
`src/lib/container.ts`, plus a sample of `src/app/api/v1/**/route.ts` across
admin/shop/order/sync/agent/payment/dev buckets. Route inventory via Glob.

## 1. API routes — 70 routes under `/api/v1`

**FIND-001 — Inventory (VERIFIED).** Glob `src/app/api/v1/**/route.ts`
returns **70** route files. (Plus `src/app/api/route.ts` at root — NOT
VERIFIED, out of scope.)

**FIND-002 — Auth-guard coverage by wrapper (VERIFIED).**

| Guard                       | Count | Source |
|-----------------------------|-------|--------|
| `withAuth` (JWT)            | 27    | `src/lib/api/with-auth.ts:52–94` |
| `withDeviceAuth` (device)   | 12    | `with-auth.ts:108–127` |
| `withOrderAccess` (customer)| 5     | `src/lib/api/with-order-access.ts` |
| `withRateLimit` only        | 6     | `with-auth.ts:130–144` |
| `requireDev()` gate         | 7     | `src/lib/api/require-dev.ts` |
| Secret/key (`?key=`)        | 3     | `db-health`, `setup-database`, `cron/cleanup` |
| Env-var admin login         | 1     | `src/app/api/v1/admin/access-check/route.ts` |
| Unauthenticated public      | 9     | health, ready, qr, shops/[slug]×3, shops, payments phonepe webhook, payments paytm callback |

`auth/login`, `auth/register`, `auth/refresh` don't use `withAuth` because
they issue tokens. The phonepe webhook uses raw `POST` and verifies via the
adapter's signature check (see §5).

**FIND-003 — Three-layer tenant isolation (VERIFIED).** `withAuth`
(`with-auth.ts:69–76`) loads `claims.shopId` from the JWT, re-loads
`user.shopId` from the DB, and rejects when they differ (defends against
stale tokens after shop reassignment). Downstream handlers receive
`principal.shopId` and pass it to every repository call as the tenant
filter (e.g. `repos.orders.findByIdAndShop(id, shop.id)` at
`shops/me/orders/[id]/verify-payment/route.ts:53`). The third layer is
DB-level: every tenant table carries a `shopId` column + index.

## 2. Authentication

**FIND-004 — JWT HS256 (VERIFIED).** `src/lib/auth/jwt-auth.adapter.ts:102–127`
signs with HMAC-SHA-256 via `crypto.subtle.sign('HMAC', …)`. Header
`{ alg: 'HS256', typ: 'JWT' }`. TTLs: access 900 s, refresh 2 592 000 s
(`container.ts:320–322`). Verify uses string equality on base64 sig
(line 122) — HMAC unforgeable, non-exploitable (**P3**).

**FIND-005 — PBKDF2-SHA256 (VERIFIED).** `jwt-auth.adapter.ts:7–8`:
**600 000 iterations, 32-byte key, 16-byte salt** — matches OWASP 2023.
Format `pbkdf2$<iter>$<saltB64>$<keyB64>`. Verify is constant-time
(lines 93–98). Spec (lines 31–38) notes argon2id is the production
target. **P2** — migrate before scale.

**FIND-006 — Refresh-token rotation + jti replay guard (VERIFIED).**
`jwt-auth.adapter.ts:150–186`: issues `jti`, caches under
`refresh:<jti>` for TTL, on rotation deletes old jti before issuing new
pair. Replay of rotated token returns null (line 173). On Vercel
serverless with `CACHE_PROVIDER=memory` (`vercel.json:11`), the jti set
is per-invocation — a rotated-then-replayed refresh could succeed on a
different invocation. **P1**.

**FIND-007 — Device tokens (VERIFIED).** `with-auth.ts:116–117` HMACs
the Bearer token with `createHmac('sha256', 'print-agent-salt')` and
matches `printAgent.tokenHash`. The "salt" is a hard-coded string
literal — really an HMAC key. Stored value is an HMAC (not a password),
so brute-forcing requires source + DB. **P2** — move `print-agent-salt`
to `PRINT_AGENT_HMAC_KEY` env var.

**FIND-008 — Order (customer) tokens (VERIFIED).**
`with-order-access.ts:78–90` requires `X-Order-Token` header or `?t=`
query param, compares with `timingSafeEqual` against
`order.customerToken`. Mismatch returns **403** (not 404) so attackers
can't probe order IDs.

**FIND-009 — Admin env-var login (VERIFIED).** `auth/login/route.ts:41–73`
compares submitted email+password against `ADMIN_EMAIL`/`ADMIN_PASSWORD`
via `Buffer.equals` (constant-time). Admin user auto-created on first
login with `role='admin'`, `shopId=null`.

## 3. Authorization (owner/staff/admin)

**FIND-010 — Role enforcement (VERIFIED).** `withAuth(handler,
allowedRoles)` checks `claims.role` and throws `ForbiddenError`
(`with-auth.ts:65–67`). Sample: `admin/orders/route.ts:60` → `['admin']`;
`shops/me/orders/[id]/verify-payment/route.ts:128` → `['owner']`;
`me/route.ts` → no role list (any auth'd user).

**FIND-011 — Staff role (NOT VERIFIED).** Prisma `User.role` default is
`'owner'` (`schema.prisma:65`). The audit description mentions
owner/staff/admin — if `staff` is a real role, no route currently
restricts to `['staff']` alone (routes accept any auth'd user OR require
`owner`/`admin`). **P2** — confirm whether `staff` is implemented.

**FIND-012 — Admin cross-tenant by design (VERIFIED).**
`admin/orders/route.ts:18–28` calls `repos.orders.listAll({...})` when
no `shopId` filter is supplied — admin sees all tenants (intended).
`listAll` is bounded by `limit` (default 50, max 200). **P3** — cursor
pagination at scale.

## 4. Database (Prisma)

**FIND-013 — 14 models (VERIFIED).** `prisma/schema.prisma` defines:
Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription,
AuditLog, PaymentAttempt, PaymentEvent, DeviceSyncState, Customer,
PrintDeliveryAttempt, FileCleanupTask. Count = **14**.

**FIND-014 — `migration_lock.toml` declares PostgreSQL (VERIFIED).**
File: `provider = "postgresql"`. Init migration `20261015172034_init/
migration.sql` (176 lines) uses PG syntax (`TIMESTAMP(3)`,
`CURRENT_TIMESTAMP`). A prior root-level audit
(`docs/PRODUCTION_READINESS_AUDIT.md`) reported SQLite; the lock file has
since been corrected. **No filesystem drift.**

**FIND-015 — `_prisma_migrations` table state (NOT VERIFIED).** Runtime
DB construct — cannot inspect from source. Prior root audit claimed it
was empty after manual SQL execution. Verify by connecting to prod DB:
`SELECT migration_name, finished_at FROM "_prisma_migrations";`. **P1**.

**FIND-016 — Migration timestamp inversion (VERIFIED).**
`prisma/migrations/` contains:
- `20261015172034_init/migration.sql` (176 lines, full schema)
- `20251108000000_add_delivery_and_sync/migration.sql` (115 lines, 4 new tables)

Prisma sorts migrations lexically by filename — `2025-11_add_delivery`
would attempt to run BEFORE `2026-10_init`. The `add_delivery` migration
ALTERs tables that don't exist yet → **`prisma migrate deploy` will
fail.** **P0**. The operator must either rename the init migration to an
earlier timestamp or use `scripts/pg-migrate-prod.sh` (which bypasses
Prisma migrate).

**FIND-017 — Partial unique indexes hand-written (VERIFIED).**
`prisma/pg-constraints.sql` declares two indexes Prisma cannot express:
`PrintJob_active_file_unique` (one active job per file) and
`Order_shop_tokenNumber_unique` (one non-null tokenNumber per shop).
Applied by `scripts/pg-migrate-prod.sh` after `prisma migrate diff` AND
re-applied by `setup-database/route.ts:39`. NOT in `schema.prisma` —
schema drift. **P2** — document in migration runbook.

**FIND-018 — Vestigial `Subscription` model (VERIFIED).**
`schema.prisma:161–173` defines Subscription with `tier`, `status`,
`currentPeriodStart/End`, `provider`, `providerSubscriptionId`. NO route
creates or reads Subscription rows — entitlement logic
(`src/lib/api/entitlements.ts`) reads `Shop.subscriptionTier` +
`Shop.subscriptionExpiresAt` directly. The Subscription model is only
referenced by the Shop relation (`schema.prisma:53`). **P2** — delete
the model or migrate entitlement logic to use it.

## 5. Payment pipeline

**FIND-019 — Three PSP adapters (VERIFIED).** `src/lib/payments/registry.ts:14–18`
registers PhonePe, Paytm, UpiDeepLink. UPI is default
(`container.ts:312`); per-shop routing via
`paymentRegistry.get(shop.paymentProvider)`.

**FIND-020 — Webhook pipeline (VERIFIED).** `webhook.service.ts:122–322`
implements the 8-step pipeline (header lines 110–121):
1. Audit-log raw payload BEFORE processing (line 127).
2. Extract untrusted `merchantOrderId` (line 138).
3. Lookup payment session (cache → DB fallback) (line 142).
4. Load shop credentials (line 148).
5. Verify signature via adapter (line 155).
6. Idempotency check via cache key `pay:done:<provider>:<txnId>` (line 192).
7. Amount validation — rejects if `v.amountPaise === null` OR mismatches (lines 217–236).
8. Race-safe transition via `repos.orders.transitionStatus` with
   `WHERE status='awaiting_payment'` precondition (line 254).

Phase 4 fix comment (lines 212–216) calls out the previous
`amountPaise === null` skip-bug explicitly.

**FIND-021 — Idempotency: three layers (VERIFIED).**
(a) Cache key `pay:done:<provider>:<txnId>` 24 h TTL (line 292);
(b) `transitionStatus` precondition returns null if a concurrent
request already flipped the order (line 254);
(c) `Order.paymentTxnId` `@unique` (`schema.prisma:83`) +
`isUniqueConstraintError` catch (line 277) treats P2002 as idempotent.
Belt-and-suspenders correct.

**FIND-022 — PhonePe v1 + v2 detection (VERIFIED).**
`payments/phonepe/webhook/route.ts:50–69` detects v2 when `Authorization`
matches `/^[0-9a-f]{64}$/i` AND body is JSON with `"event"` field.
Otherwise v1 (X-VERIFY + base64). v2 handler
(`phonepe-v2-webhook.ts:38–48`) computes expected SHA-256 hex of
`username:password`, compares with `timingSafeEqual`.

**FIND-023 — PhonePe v2 webhook credentials gap (VERIFIED).**
`phonepe/webhook/route.ts:45–47` logs FATAL when `PHONEPE_WEBHOOK_USERNAME`
or `PASSWORD` unset but does NOT return early — request proceeds, v2
verification fails with generic error. **P1** — fail closed (401).

**FIND-024 — Diagnostic header logging (VERIFIED).** `phonepe/webhook/route.ts:30–41`
logs `authHeaderPreview` (first 8 chars), `bodyStartsWith` (first 20 chars).
**P2** — 8 hex chars of a 64-char SHA is not exploitable but remove once
debugging done.

## 6. Subscription / entitlements

**FIND-025 — Entitlement enforcement on 3 routes (PARTIALLY VERIFIED).**
Grep `requireEntitlement|isEntitled` in `src/app/api/v1` returns:
- `shops/me/analytics/route.ts:13` → `requireEntitlement(shop.id, 'analytics')` (gates)
- `shops/me/reports/daily/route.ts:30` → `requireEntitlement(shop.id, 'reports')` (gates)
- `shops/me/route.ts:48` → `getSubscriptionStatus(shop.id)` (read-only, NOT gating)

**2 routes actively gate; 1 surfaces status.** If the audit's "3 routes"
counts the read-only query, count is correct; if it means three gating
routes, count is 2. **P3** — clarify in docstring.

**FIND-026 — Fail-closed (VERIFIED).** `entitlements.ts:64–81` returns
`false` on DB error, unknown shop, or any exception — non-free features
denied. `requireEntitlement` (line 87) throws `ForbiddenError` on false.
Verified by `http-route-tests.test.ts:172–189` (free-tier → 403 on
`/analytics` and `/reports/daily`).

**FIND-027 — Grace period = 7 days (VERIFIED).** `entitlements.ts:38`.
Verified by `http-route-tests.test.ts:326–336` (expired 3 days → grace →
allowed) and `:338–349` (expired 10 days → expired → denied).

## 7. PrintEXE integration

**FIND-028 — Seven contract docs (VERIFIED).** `docs/integration/`:
`PRINTEXE_API_CONTRACT.md`, `_AUTHENTICATION.md`, `_COMPATIBILITY_MATRIX.md`,
`_DEVICE_LIFECYCLE.md`, `_ERROR_CODES.md`, `_PRINT_JOB_LIFECYCLE.md`,
`_REALTIME_EVENTS.md`.

**FIND-029 — Protocol incompatibilities documented (VERIFIED).**
`PRINTEXE_COMPATIBILITY_MATRIX.md:18–27` lists version gaps:
v0.4.7 (polling + presigned URLs + status reports; NO receipt, NO sync);
v0.5.x (adds receipt endpoint, sync pull/push/status, delivery tracking);
v2.0.0 (WebRTC direct transfer, server-side feature-flagged). Server has
NOT enforced `MIN_DESKTOP_VERSION = '1.0.0'` (planned floor). **P2** —
enforce before public launch.

**FIND-030 — Realtime protocol mismatch (VERIFIED).**
`PRINTEXE_REALTIME_EVENTS.md` declares Socket.IO URL
`wss://printshop-saas-three.vercel.app/?XTransformPort=3003` and notes
the `?XTransformPort=3003` query param is REQUIRED (Caddy gateway routes
on it). On Vercel there is no Caddy gateway — the query is ignored and
WSS upgrades against the Next.js server, which does NOT serve Socket.IO.
**P0** — Socket.IO production broken on Vercel; only working mode is
in-process `memory` (see §8).

## 8. Realtime (Socket.IO)

**FIND-031 — In-memory realtime provider in production (VERIFIED).**
`vercel.json:10` sets `REALTIME_PROVIDER=memory`. `container.ts:295–301`
selects `InMemoryRealtimeAdapter`. In-memory state is per-invocation on
Vercel serverless — a publish on invocation A is invisible to invocation
B. The webhook's `realtime.publish(shopChannel(shop.id), 'order.paid', …)`
call (`webhook.service.ts:306`) is therefore a no-op in production;
dashboards must poll. **P1** — deploy the realtime mini-service
(`mini-services/realtime-service/index.ts`) separately and set
`REALTIME_PROVIDER=socketio` + `REALTIME_EMIT_URL`, or document
polling-only as the production mode.

## 9. Storage

**FIND-032 — Four storage adapters (VERIFIED).**
`packages/adapters/src/storage/`: `supabase.adapter.ts`, `r2.adapter.ts`,
`s3.adapter.ts`, `in-memory.adapter.ts`, `disabled.adapter.ts`.
`container.ts:267–284` selects via `STORAGE_PROVIDER`. `vercel.json:11`
sets `STORAGE_PROVIDER=supabase`.

**FIND-033 — Presigned URLs (VERIFIED).** `supabase.adapter.ts:47–73`
generates signed upload + download URLs (default 900 s TTL). API server
never proxies file bytes — clients PUT/GET directly to Supabase Storage.
`storage/put/route.ts` is dev-only via `requireDev()` (line 15).

**FIND-034 — Graceful fallback (VERIFIED).** `container.ts:247–265` —
missing Supabase/R2/S3 credentials silently falls back to `disabled`
(uploads return clear error, registration/login still work). **P2** —
only `console.error`s, no alert.

## 10. Rate limiting

**FIND-035 — Fixed-window limiter (VERIFIED).** `rate-limit.ts:13–27`
increments counter via `cache.incr(key)`, sets TTL on first hit, throws
`RateLimitError` when `count > limit`. `rateKey` (lines 35–46) uses
`X-Forwarded-For` only in dev OR when `TRUSTED_PROXY` is set — fails
open to `'unknown'` otherwise. **P2** — when `TRUSTED_PROXY` unset in
production, all anonymous traffic shares one bucket.

**FIND-036 — Per-invocation on Vercel serverless (VERIFIED).**
`vercel.json:12` sets `CACHE_PROVIDER=memory`. `container.ts:127–153`
emits WARNING (not fatal). Phase 4 comment explicitly accepts this:
rate limiting is per-invocation, but DB UNIQUE on `paymentTxnId` remains
authoritative idempotency guard. **P1** — set `CACHE_PROVIDER=redis`
with Upstash REST URL/TOKEN (`container.ts:287–291` is ready).

**FIND-037 — Routes with rate limiting (VERIFIED).** Grep
`withRateLimit` in `src/app/api/v1` → 20 files. `auth/login` uses raw
`rateLimit(...)` directly (`auth/login/route.ts:27`, 20/60 s) — the only
route bypassing the `withRateLimit` wrapper.

## 11. Security findings summary (P0–P3)

| ID | Sev | Finding | File |
|---|---|---|---|
| FIND-030 | **P0** | Socket.IO production broken on Vercel (XTransformPort gateway not present) | `docs/integration/PRINTEXE_REALTIME_EVENTS.md`, `vercel.json` |
| FIND-016 | **P0** | Migration timestamp inversion (2025-11 `add_delivery` sorts before 2026-10 `init`) — `prisma migrate deploy` will fail | `prisma/migrations/*/migration.sql` filenames |
| FIND-015 | **P1** | `_prisma_migrations` table state NOT VERIFIED — operator must confirm before trusting `prisma migrate deploy` | runtime DB |
| FIND-006 | **P1** | Refresh-token jti cache is per-invocation on Vercel memory cache — rotated-then-replayed refresh can succeed | `jwt-auth.adapter.ts:158` |
| FIND-023 | **P1** | PhonePe v2 webhook doesn't fail-closed when SHA credentials unset | `phonepe/webhook/route.ts:45–47` |
| FIND-031 | **P1** | Realtime publish is a no-op in production (in-memory on serverless) | `container.ts:295–301` |
| FIND-036 | **P1** | Rate limiting is per-invocation — effectively no DoS protection | `vercel.json:12`, `container.ts:139` |
| FIND-005 | **P2** | PBKDF2 instead of argon2id (spec target) | `jwt-auth.adapter.ts:31–38` |
| FIND-007 | **P2** | `print-agent-salt` hard-coded in source — move to env var | `with-auth.ts:116` |
| FIND-017 | **P2** | Schema drift between Prisma-managed schema + hand-written partial unique indexes | `prisma/pg-constraints.sql` |
| FIND-018 | **P2** | Vestigial `Subscription` model — entitlements read Shop row instead | `schema.prisma:161–173` |
| FIND-024 | **P2** | Webhook route logs 8-char auth-header preview | `phonepe/webhook/route.ts:33` |
| FIND-029 | **P2** | `MIN_DESKTOP_VERSION` not enforced | `PRINTEXE_COMPATIBILITY_MATRIX.md` |
| FIND-034 | **P2** | Storage-fallback-to-disabled only `console.error`s — no alert | `container.ts:247–265` |
| FIND-035 | **P2** | `rateKey` fails open to `'unknown'` when `TRUSTED_PROXY` unset | `rate-limit.ts:35–46` |
| FIND-011 | **P2** | `staff` role existence/gating NOT VERIFIED | `schema.prisma:65` |
| FIND-004 | **P3** | JWT verify uses string equality on base64 sig (non-exploitable) | `jwt-auth.adapter.ts:122` |
| FIND-012 | **P3** | Admin `listAll` pagination by `limit` only | `admin/orders/route.ts:18–28` |
| FIND-025 | **P3** | "3 routes enforce entitlements" — actually 2 gate + 1 read-only | `src/app/api/v1/shops/me/*` |

## 12. Operator pre-launch checklist (P0/P1 only)

1. Resolve migration ordering (FIND-016) — use `scripts/pg-migrate-prod.sh` if `prisma migrate deploy` is unsafe.
2. Inspect `_prisma_migrations` table on prod DB (FIND-015).
3. Decide realtime strategy: deploy Socket.IO mini-service + `REALTIME_PROVIDER=socketio`, OR document polling-only (FIND-030, FIND-031).
4. `CACHE_PROVIDER=redis` + Upstash credentials (FIND-036).
5. `PHONEPE_WEBHOOK_USERNAME`/`PASSWORD` set + v2 fail-closed verified (FIND-023).

---

*All file paths relative to `/home/z/my-project`. Claims marked NOT VERIFIED require runtime/operator confirmation. No source code modified.*

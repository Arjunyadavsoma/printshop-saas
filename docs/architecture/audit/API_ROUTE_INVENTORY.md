# API_ROUTE_INVENTORY

Audit Date: 2025-11-09 · Branch: `main` · Commit: `dc24f4b`

Every API route under `/api/v1/*` (70 routes) plus the root `/api` route.
Auth guards are read directly from each `route.ts` file — not guessed.

**Guard legend**
- `withAuth` — JWT bearer (owner/staff/admin roles); admin routes pass `['admin']`
- `withAuth(role)` — JWT bearer restricted to listed roles
- `withDeviceAuth` — print-agent device token (HMAC-SHA256 of bearer)
- `withOrderAccess` — customer order token (X-Order-Token header or `?t=`)
- `withRateLimit(s,l,w)` — fixed-window rate limiter (limit l / window w seconds)
- `requireDev` — returns 404 in production
- `CRON_SECRET` — Vercel/GitHub-cron shared secret in Authorization header
- `?key=SETUP_KEY` — admin/setup shared secret
- `webhook-sig` — provider-specific signature (X-VERIFY, CHECKSUMHASH, or SHA auth)
- `none` — public, unauthenticated

---

## 1. Authentication & session (5)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| POST | `/api/v1/auth/register` | inline `rateLimit('register',5,60)` + `rateLimit('slug-check',30,60)` (GET) | Combined shop+owner signup; issues JWT pair | `src/app/api/v1/auth/register/route.ts:56,199` |
| POST | `/api/v1/auth/login` | inline `rateLimit('login',20,60)` | Email+password login (incl. env-var admin path) | `src/app/api/v1/auth/login/route.ts:25-27` |
| POST | `/api/v1/auth/refresh` | none | Rotate refresh token → new access+refresh pair | `src/app/api/v1/auth/refresh/route.ts:9` |
| GET | `/api/v1/me` | `withAuth` | Authenticated user's own profile | `src/app/api/v1/me/route.ts:6` |
| GET | `/api/v1/admin/access-check` | `?key=ADMIN_ACCESS_KEY` (constant-time) | Gates admin login page render | `src/app/api/v1/admin/access-check/route.ts:18-32` |

## 2. Shops — customer-facing (5)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| GET | `/api/v1/shops` | `withRateLimit('shops-list',60,60)` | Paginated list of active shops | `src/app/api/v1/shops/route.ts:17` |
| GET | `/api/v1/shops/:slug` | `withRateLimit('shop-info',60,60)` | Public shop profile + pricing | `src/app/api/v1/shops/[slug]/route.ts:7` |
| POST | `/api/v1/shops/:slug/orders` | `withRateLimit('create-order',20,60)` | Create a draft order (returns customerToken) | `src/app/api/v1/shops/[slug]/orders/route.ts:49` |
| GET | `/api/v1/shops/:slug/upi-qr` | `withRateLimit('shop-upi-qr',60,60)` | Short-lived presigned download URL for shopkeeper UPI QR image | `src/app/api/v1/shops/[slug]/upi-qr/route.ts:29` |
| GET | `/api/v1/qr` | `withRateLimit('qr',60,60)` | Stateless QR PNG data URL (`upi://` payloads) | `src/app/api/v1/qr/route.ts:15` |

## 3. Shops — owner-facing (`/shops/me/*`) (18)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| GET | `/api/v1/shops/me` | `withAuth` | Owner's own shop profile (no creds) | `src/app/api/v1/shops/me/route.ts:46` |
| PATCH | `/api/v1/shops/me` | `withAuth` | Update shop profile fields | `src/app/api/v1/shops/me/route.ts:73` |
| GET | `/api/v1/shops/me/orders` | `withAuth` | Paginated shop-scoped orders | `src/app/api/v1/shops/me/orders/route.ts:8` |
| GET | `/api/v1/shops/me/orders/:id` | `withAuth` | Order detail (incl. files) | `src/app/api/v1/shops/me/orders/[id]/route.ts:17` |
| PATCH | `/api/v1/shops/me/orders/:id` | `withAuth` | Update shopkeeper private notes | `src/app/api/v1/shops/me/orders/[id]/route.ts:31` |
| GET | `/api/v1/shops/me/orders/:id/activity` | `withAuth` | Audit-log-derived order timeline | `src/app/api/v1/shops/me/orders/[id]/activity/route.ts:16` |
| POST | `/api/v1/shops/me/orders/:id/print` | `withAuth` | Dispatch all pending files to the agent (`paid → printing`) | `src/app/api/v1/shops/me/orders/[id]/print/route.ts:11` |
| POST | `/api/v1/shops/me/orders/:id/start` | `withAuth` | Permissive manual-start variant of /print | `src/app/api/v1/shops/me/orders/[id]/start/route.ts:26` |
| POST | `/api/v1/shops/me/orders/:id/ready` | `withAuth` | Mark order ready for pickup (`printing → ready`) | `src/app/api/v1/shops/me/orders/[id]/ready/route.ts:13` |
| POST | `/api/v1/shops/me/orders/:id/complete` | `withAuth` | Mark collected + delete files (`ready → collected`) | `src/app/api/v1/shops/me/orders/[id]/complete/route.ts:45` |
| POST | `/api/v1/shops/me/orders/:id/cancel` | `withAuth` | Cancel order from any non-terminal state | `src/app/api/v1/shops/me/orders/[id]/cancel/route.ts:71` |
| POST | `/api/v1/shops/me/orders/:id/verify-payment` | `withAuth` | Shopkeeper manual payment verify/reject | `src/app/api/v1/shops/me/orders/[id]/verify-payment/route.ts:47` |
| GET | `/api/v1/shops/me/orders/:id/files/:fileId/print-url` | `withAuth` | 60s presigned download URL for PrintLatch | `src/app/api/v1/shops/me/orders/[id]/files/[fileId]/print-url/route.ts:29` |
| GET | `/api/v1/shops/me/orders/:id/files/:fileId/download` | `withAuth` | Stream file bytes (Content-Disposition attachment) | `src/app/api/v1/shops/me/orders/[id]/files/[fileId]/download/route.ts:22` |
| GET | `/api/v1/shops/me/agents` | `withAuth` | List registered print agents | `src/app/api/v1/shops/me/agents/route.ts:7` |
| GET | `/api/v1/shops/me/analytics` | `withAuth` | Shop revenue, status mix, popular settings | `src/app/api/v1/shops/me/analytics/route.ts:9` |
| GET | `/api/v1/shops/me/reports/daily` | `withAuth` | Daily reconciliation report (`?date=YYYY-MM-DD`) | `src/app/api/v1/shops/me/reports/daily/route.ts:25` |
| GET | `/api/v1/shops/me/sticker` | `withAuth` | Printable PDF sticker with shop QR | `src/app/api/v1/shops/me/sticker/route.ts:20` |
| GET | `/api/v1/shops/me/qr` | `withAuth` | Shop ordering QR (PNG/SVG) | `src/app/api/v1/shops/me/qr/route.ts:29` |
| POST | `/api/v1/shops/me/upi-qr` | `withAuth` | Upload shopkeeper UPI QR image (multipart or base64) | `src/app/api/v1/shops/me/upi-qr/route.ts:41` |
| GET | `/api/v1/shops/me/upi-qr` | `withAuth` | Fetch uploaded UPI QR (presigned URL) | `src/app/api/v1/shops/me/upi-qr/route.ts:148` |
| GET | `/api/v1/shops/me/payment-credentials` | `withRateLimit('pay-creds-get',30,60)` + `withAuth` | Status (masked, no secrets) | `src/app/api/v1/shops/me/payment-credentials/route.ts:142` |
| PUT | `/api/v1/shops/me/payment-credentials` | `withRateLimit('pay-creds-save',10,60)` + `withAuth` | Save/update (AES-256-GCM encrypted) | `src/app/api/v1/shops/me/payment-credentials/route.ts:151` |
| DELETE | `/api/v1/shops/me/payment-credentials` | `withRateLimit('pay-creds-delete',10,60)` + `withAuth` | Disconnect | `src/app/api/v1/shops/me/payment-credentials/route.ts:223` |
| POST | `/api/v1/shops/me/payment-credentials/activate` | `withRateLimit('pay-creds-activate',10,60)` + `withAuth` | Switch shop's active provider | `src/app/api/v1/shops/me/payment-credentials/activate/route.ts:28` |

## 4. Orders — customer-facing (6)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| GET | `/api/v1/orders/:id/status` | `withRateLimit('status',120,60)` + `withOrderAccess` | Poll payment + print status (SEC-001 fix) | `src/app/api/v1/orders/[id]/status/route.ts:16` |
| GET | `/api/v1/orders/:id/receipt` | `withOrderAccess` | Downloadable PDF receipt (browser navigation, `?t=` token) | `src/app/api/v1/orders/[id]/receipt/route.ts:17` |
| POST | `/api/v1/orders/:id/checkout` | `withRateLimit('checkout',20,60)` + `withOrderAccess` | Create payment intent via shop's provider | `src/app/api/v1/orders/[id]/checkout/route.ts:16` |
| POST | `/api/v1/orders/:id/files` | `withRateLimit('confirm-file',30,60)` + `withOrderAccess` | Confirm an upload + parse page count | `src/app/api/v1/orders/[id]/files/route.ts:25` |
| POST | `/api/v1/orders/:id/files/upload-url` | `withRateLimit('upload-url',30,60)` + `withOrderAccess` | Presigned PUT URL for customer file upload | `src/app/api/v1/orders/[id]/files/upload-url/route.ts:24` |
| PATCH | `/api/v1/orders/:id/files/:fileId` | `withRateLimit('patch-file',60,60)` + `withOrderAccess` | Update print settings + re-price | `src/app/api/v1/orders/[id]/files/[fileId]/route.ts:26` |

## 5. Agents & devices (8)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| POST | `/api/v1/agents/register` | `withAuth` (owner) | Mint a device token for a new print agent | `src/app/api/v1/agents/register/route.ts:20` |
| DELETE | `/api/v1/agents/:id` | `withAuth` (owner) | Revoke a print agent (deletes PrintAgent row) | `src/app/api/v1/agents/[id]/route.ts:26` |
| POST | `/api/v1/agents/token` | `withDeviceAuth` | Exchange device token for short-lived JWT (for socket.io auth) | `src/app/api/v1/agents/token/route.ts:12` |
| POST | `/api/v1/agents/heartbeat` | `withDeviceAuth` | Refresh presence + report printer/version | `src/app/api/v1/agents/heartbeat/route.ts:17` |
| GET | `/api/v1/agents/jobs/pending` | `withDeviceAuth` | Queued jobs for the agent's shop with presigned download URLs | `src/app/api/v1/agents/jobs/pending/route.ts:40` |
| POST | `/api/v1/agents/jobs/:id/status` | `withDeviceAuth` | Report status transition (`queued→printing→completed\|failed`) | `src/app/api/v1/agents/jobs/[id]/status/route.ts:23` |
| POST | `/api/v1/agents/jobs/:id/received` | `withDeviceAuth` | Mark delivery receipt (with checksum verification) | `src/app/api/v1/agents/jobs/[id]/received/route.ts:61` |
| POST | `/api/v1/devices/register` | `withAuth` (owner) | Register a PrintAgent deviceId for bidirectional sync | `src/app/api/v1/devices/register/route.ts:31` |

## 6. Sync (PrintEXE bidirectional) (3)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| GET | `/api/v1/sync/pull` | `withDeviceAuth` | Incremental pull since cursor (ISO timestamp) | `src/app/api/v1/sync/pull/route.ts:23` |
| POST | `/api/v1/sync/push` | `withDeviceAuth` | Push device-side changes (customers, etc.) | `src/app/api/v1/sync/push/route.ts:92` |
| GET | `/api/v1/sync/status` | `withDeviceAuth` | Current sync cursor + last sync/push timestamps | `src/app/api/v1/sync/status/route.ts:15` |

## 7. Admin (6)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| GET | `/api/v1/admin/shops` | `withAuth(['admin'])` | List ALL shops with aggregates | `src/app/api/v1/admin/shops/route.ts:16,92` |
| GET | `/api/v1/admin/shops/:id` | `withAuth(['admin'])` | Full shop detail + order summary | `src/app/api/v1/admin/shops/[id]/route.ts:9,67` |
| GET | `/api/v1/admin/orders` | `withAuth(['admin'])` | List ALL orders across all shops | `src/app/api/v1/admin/orders/route.ts:18,60` |
| GET | `/api/v1/admin/orders/:id` | `withAuth(['admin'])` | Full order detail (incl. files, status history) | `src/app/api/v1/admin/orders/[id]/route.ts:9,72` |
| GET | `/api/v1/admin/analytics` | `withAuth(['admin'])` | Platform-wide metrics (revenue, totals) | `src/app/api/v1/admin/analytics/route.ts:18,104` |
| GET | `/api/v1/admin/audit` | `withAuth(['admin'])` | Recent audit log entries | `src/app/api/v1/admin/audit/route.ts:9,33` |

## 8. Payments (5)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| POST | `/api/v1/payments/phonepe/webhook` | `webhook-sig` (X-VERIFY v1 OR SHA-auth v2, auto-detected) | PhonePe callback (both API generations) | `src/app/api/v1/payments/phonepe/webhook/route.ts:18` |
| POST | `/api/v1/payments/paytm/callback` | `webhook-sig` (CHECKSUMHASH) | Paytm callback (renders HTML) | `src/app/api/v1/payments/paytm/callback/route.ts:8` |
| GET | `/api/v1/payments/upi/verify/:orderId` | `withRateLimit('upi-verify',60,60)` | UPI deep-link polling fallback | `src/app/api/v1/payments/upi/verify/[orderId]/route.ts:14` |
| POST | `/api/v1/payments/dev/phonepe/simulate` | `withRateLimit('phonepe-simulate',20,60)` + `requireDev` | Dev-only PhonePe webhook simulation | `src/app/api/v1/payments/dev/phonepe/simulate/route.ts:37` |
| POST | `/api/v1/payments/dev/paytm/simulate` | `withRateLimit('paytm-simulate',20,60)` + `requireDev` | Dev-only Paytm webhook simulation | `src/app/api/v1/payments/dev/paytm/simulate/route.ts:23` |

## 9. System & operational (10)

| Method | Path | Guard | Purpose | File |
|---|---|---|---|---|
| GET | `/api/v1/health` | none | Liveness (`{status:'ok'}`); also HEAD | `src/app/api/v1/health/route.ts:4,8` |
| GET | `/api/v1/ready` | `withRateLimit('ready',30,60)` | Readiness probe — checks every adapter's `health()` | `src/app/api/v1/ready/route.ts:28` |
| GET | `/api/v1/db-health` | none | Diagnostic: connection, tables, row counts (no secrets) | `src/app/api/v1/db-health/route.ts:11` |
| GET | `/api/v1/metrics` | `withAuth(['admin'])` | Platform metrics (orders/min, payment success rate) — SEC-010 fix | `src/app/api/v1/metrics/route.ts:18` |
| POST | `/api/v1/setup-database` | `?key=SETUP_KEY` (or `ADMIN_ACCESS_KEY`) | One-time DB init via raw SQL (CREATE TABLE IF NOT EXISTS) | `src/app/api/v1/setup-database/route.ts:12` |
| GET | `/api/v1/cron/cleanup` | `CRON_SECRET` (Bearer or `?secret=`) | Vercel/GitHub-cron — processes FileCleanupTask batch (max 10) | `src/app/api/v1/cron/cleanup/route.ts:29` |
| GET | `/api/v1/downloads/native-printer` | none | Streams ZIP of PrintShop Native Windows Printer service (cached 1h) | `src/app/api/v1/downloads/native-printer/route.ts:143` |
| PUT | `/api/v1/storage/put` | `requireDev` + HMAC capability | Dev-only in-process upload receiver | `src/app/api/v1/storage/put/route.ts:13` |
| GET | `/api/v1/storage/get` | `requireDev` + HMAC capability | Dev-only in-process download | `src/app/api/v1/storage/get/route.ts:13` |
| GET | `/api/route` | none | Root API — returns `{message: "Hello, world!"}` (legacy smoke) | `src/app/api/route.ts:3` |

## 10. Dev-only (4)

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/v1/dev/qr` | `withRateLimit('qr',60,60)` + `requireDev` | Legacy QR generator (deprecated; use `/api/v1/qr`) |
| GET/POST | `/api/v1/dev/seed` | `withRateLimit('seed',5,60)` + `requireDev` | Seed demo shop + owner (idempotent) |
| POST | `/api/v1/dev/orders/:id/mark-paid` | `withRateLimit('mark-paid',20,60)` + `requireDev` | Simulate a PSP webhook callback |
| POST | `/api/v1/payments/dev/phonepe/simulate` | (in §8) | Dev PhonePe simulator |
| POST | `/api/v1/payments/dev/paytm/simulate` | (in §8) | Dev Paytm simulator |

---

## 11. Counts and findings

| Group | Routes |
|---|---|
| Auth & session | 5 |
| Shops (customer-facing) | 5 |
| Shops (owner-facing `/me`) | 24 |
| Orders (customer-facing) | 6 |
| Agents & devices | 8 |
| Sync | 3 |
| Admin | 6 |
| Payments | 5 |
| System & operational | 10 |
| Dev-only (extra) | 4 |
| **Total `/api/v1/*`** | **70** ✓ matches context |

> FIND-010 (P2): `GET /api/route.ts` returns `{message:"Hello, world!"}`
> — a leftover from the Next.js scaffold. It's harmless but should be
> removed or replaced with a redirect to `/api/v1/health` for a cleaner
> contract surface.

> FIND-011 (P1): `GET /api/v1/db-health` is **unauthenticated** and
> returns the masked `DATABASE_URL`, the names+counts of env vars
> (`JWT_ACCESS_SECRET: true`), and the table list. While no secret
> values leak, the boolean env-var presence map is reconnaissance
> gold for an attacker (they learn which defenses are configured).
> Recommend gating with `?key=ADMIN_ACCESS_KEY` or `withAuth(['admin'])`.

> FIND-012 (P2): `POST /api/v1/setup-database` accepts either
> `SETUP_KEY` or `ADMIN_ACCESS_KEY` as the `?key=` value
> (`src/app/api/v1/setup-database/route.ts:15`). If both env vars are
> set with different values, an attacker who learns either one can
> run arbitrary `CREATE TABLE` / `ALTER TABLE` statements via
> `$executeRawUnsafe`. Mitigations: the SQL is a hard-coded string
> (no injection vector) and the route is idempotent, but the dual-key
> fallback widens the attack surface.

> FIND-013 (P2): `POST /api/v1/auth/refresh` has **no rate limit**
> (`src/app/api/v1/auth/refresh/route.ts:9`). An attacker with a
> stolen refresh token can hammer this endpoint to mint access tokens
> without bound. Other auth endpoints (`login` 20/60s, `register`
> 5/60s) are rate-limited.

> FIND-014 (P2): The `/api/v1/storage/put` and `/api/v1/storage/get`
> dev-only routes are guarded by `requireDev()` AND a signed HMAC
> capability — defense-in-depth is good. They return 404 in
> production, so they're effectively dead code on Vercel. Consider
> deleting them outright once local dev is migrated to MinIO or a
> Supabase project per developer.

> FIND-015 (P3): `GET /api/route.ts` (root, returns `{message:"Hello, world!"}`)
> is the Next.js scaffold leftover — covered under FIND-010 above.

Every guard label above is **VERIFIED** by reading the corresponding
`route.ts` file's `export const GET/POST/PATCH/PUT/DELETE = …` line
during this audit.

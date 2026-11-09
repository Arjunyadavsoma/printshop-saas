# AUTHORIZATION_MATRIX

Audit Date: 2025-11-09 · Branch: `main` · Commit: `dc24f4b`

Documents the authorization model: who can call what, what data they can
read/write, and how tenant isolation is enforced at three layers.

---

## 1. The three auth systems

| System | Token | Header | Verifier | Tenant scope source | TTL |
|---|---|---|---|---|---|
| **JWT** (owner/staff/admin) | HS256 JWT, signed with `JWT_ACCESS_SECRET` | `Authorization: Bearer <jwt>` | `JwtAuthAdapter.verifyAccessToken` (`src/lib/auth/jwt-auth.adapter.ts`) | `claims.shopId` cross-checked against `user.shopId` on every request (`src/lib/api/with-auth.ts:73-76`) | access 900 s, refresh 30 d |
| **Device token** (print agents) | opaque random string, only `SHA-256(token)` persisted | `Authorization: Bearer <token>` | `withDeviceAuth` (`src/lib/api/with-auth.ts:108`) — HMAC-SHA256 with salt `'print-agent-salt'`, compared against `printAgent.tokenHash` | `agent.shopId` (from the matched `PrintAgent` row) | indefinite (until revoked via `DELETE /api/v1/agents/:id`) |
| **Order token** (customers) | opaque random string, persisted as `Order.customerToken` | `X-Order-Token` header OR `?t=` query | `withOrderAccess` (`src/lib/api/with-order-access.ts:64`) — constant-time `timingSafeEqual` against `order.customerToken` | bound to a single `Order.id`; no broader scope | indefinite (until order deleted) |

> FIND-024 (P2): The three systems are mutually exclusive — there is no
> path where a customer order token can be elevated to a JWT, and no
> path where a device token can access customer-facing order routes.
> This is good defense-in-depth. The one exception is
> `POST /api/v1/agents/token` (`src/app/api/v1/agents/token/route.ts:12`)
> which **exchanges** a device token for a short-lived JWT
> (`role='staff'`) — used only for Socket.IO auth on the realtime
> relay, NOT for HTTP route access.

## 2. Roles

| Role | Where defined | How obtained | `shopId` |
|---|---|---|---|
| `owner` | `packages/core/src/domain/enums.ts`, default in `User.role` | `POST /api/v1/auth/register` (creates User+Shop) | the owned shop's id |
| `staff` | same enum | `agents/token` exchange (for print agents) — no human staff onboarding flow exists yet | the agent's shopId |
| `admin` | same enum | `POST /api/v1/auth/login` when email matches `ADMIN_EMAIL` env var (`src/app/api/v1/auth/login/route.ts:31-40`) | `null` (platform-wide) |
| `customer` | (implicit, not a `User.role`) | `POST /api/v1/shops/:slug/orders` returns `customerToken` | bound to a single order |
| `device` | (implicit, not a `User.role`) | `POST /api/v1/agents/register` returns plaintext token (once) | the agent's `shopId` |

> FIND-025 (P2): There is **no staff onboarding flow** for humans. The
> `staff` role is only ever assigned to the short-lived JWT minted for
> print-agent Socket.IO auth. A shopkeeper cannot today invite a human
> staff member with limited dashboard permissions. The role exists in
> the enum but is unreachable via UI/API for humans.

> FIND-026 (P2): The admin login path stores the admin password in the
> `ADMIN_PASSWORD` env var, compared in-memory with
> `Buffer.equals` (constant-time — `src/app/api/v1/auth/login/route.ts:18-23`).
> The admin user is NOT a row in the `User` table. This means the
> admin's JWT `sub` is the email string (not a UUID), and admin actions
> are NOT audit-logged with a `userId` (the audit log
> `userId` field will be null for admin actions).

## 3. Per-role endpoint access

### 3.1 Customer (order token)

| Endpoint | Rate limit | Purpose |
|---|---|---|
| `GET /api/v1/orders/:id/status` | 120/60s | Poll payment + print status |
| `GET /api/v1/orders/:id/receipt` | none (token-bound) | Download PDF receipt |
| `POST /api/v1/orders/:id/checkout` | 20/60s | Create payment intent |
| `POST /api/v1/orders/:id/files` | 30/60s | Confirm upload + parse page count |
| `POST /api/v1/orders/:id/files/upload-url` | 30/60s | Get presigned PUT URL |
| `PATCH /api/v1/orders/:id/files/:fileId` | 60/60s | Update print settings + re-price |
| (any public route) | per-route | `/shops`, `/shops/:slug`, `/shops/:slug/orders`, `/qr`, etc. |

The customer **cannot** read another customer's order: every `/orders/:id/*`
route runs `withOrderAccess` which constant-time-compares the presented
token against `order.customerToken`. Mismatch → 403 (not 404 — hides
order existence).

> FIND-027 (P1): `GET /api/v1/orders/:id/receipt` is **not rate-limited**
> at the route level (`src/app/api/v1/orders/[id]/receipt/route.ts:17` —
> bare `withOrderAccess`, no `withRateLimit` wrapper). An attacker with a
> valid order token (or one brute-forcing tokens) can hammer the receipt
> PDF generation, which runs `pdf-lib` on every call (CPU-intensive).
> Recommend adding `withRateLimit('receipt', 30, 60)`.

### 3.2 Owner (JWT, role=owner)

Every `/api/v1/shops/me/*` route (24 total — see API_ROUTE_INVENTORY §3).
Plus: `POST /api/v1/agents/register`, `DELETE /api/v1/agents/:id`,
`POST /api/v1/devices/register`, `GET /api/v1/me`.

**Cannot** access `/api/v1/admin/*` — those routes pass `['admin']` as
the `allowedRoles` argument to `withAuth`, so a JWT with `role=owner`
gets 403 (`src/lib/api/with-auth.ts:65-67`).

### 3.3 Staff (JWT, role=staff)

Currently only the print-agent-exchanged JWT (FIND-024). With the
existing code, a `staff` JWT can access any `withAuth()` route that
does NOT pass `allowedRoles` — which is the majority of `/shops/me/*`.
This is broader than intended for a human staff role.

> FIND-028 (P1): Most `/api/v1/shops/me/*` routes call `withAuth(handler)`
> without an `allowedRoles` argument, meaning any authenticated JWT
> (owner, staff, OR admin) can call them. There is no per-route
> distinction between owner-only actions (e.g. `DELETE
> /payment-credentials`, `PATCH /shops/me`) and staff-appropriate
> actions (e.g. `POST /orders/:id/start`). If/when human staff are
> onboarded, they will have full owner-equivalent power. Recommend
> adding `allowedRoles: ['owner']` to destructive routes.

### 3.4 Admin (JWT, role=admin, shopId=null)

All `/api/v1/admin/*` routes (6 — see API_ROUTE_INVENTORY §7) +
`GET /api/v1/metrics`. The `shopId=null` admin JWT bypasses the
`findByIdAndShop` tenant filter by calling `findById` directly
(`src/app/api/v1/admin/orders/[id]/route.ts:13`).

### 3.5 Device (device token)

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/agents/token` | Exchange for short-lived JWT |
| `POST /api/v1/agents/heartbeat` | Refresh presence |
| `GET /api/v1/agents/jobs/pending` | Fetch queued jobs (shop-scoped) |
| `POST /api/v1/agents/jobs/:id/status` | Report transition |
| `POST /api/v1/agents/jobs/:id/received` | Mark delivery receipt |
| `GET /api/v1/sync/pull` | Incremental pull |
| `POST /api/v1/sync/push` | Push changes |
| `GET /api/v1/sync/status` | Sync cursor state |

All device routes enforce tenant isolation via `agent.shopId` — the
shopId is derived from the matched `PrintAgent` row, never from the
query string or body.

> FIND-029 (P2): `withDeviceAuth` refreshes `lastSeenAt` + `isOnline`
> on **every authenticated call** (`src/lib/api/with-auth.ts:121`).
> This is a write-on-read pattern — every device API call triggers a
> DB UPDATE. For a polling agent (e.g. `GET /jobs/pending` every 2s),
> this doubles the DB write load. Consider moving presence refresh to
> the explicit `/heartbeat` route only.

## 4. Tenant isolation: three layers

The codebase defends tenant boundaries at three layers per request:

### Layer 1 — Auth (token verification)

`withAuth` / `withDeviceAuth` / `withOrderAccess` verify the token AND
attach a `principal.shopId` (or `order`) to the handler. No route handler
ever trusts a `shopId` from the request body or query.

Evidence:
- `withAuth` re-fetches `User` and rejects if `claims.shopId !== user.shopId`
  (`src/lib/api/with-auth.ts:73-76`).
- `withDeviceAuth` resolves `agent.shopId` from the matched `PrintAgent`
  (`src/lib/api/with-auth.ts:117-121`).
- `withOrderAccess` loads the `Order` and only proceeds if the token
  matches (`src/lib/api/with-order-access.ts:74-90`).

### Layer 2 — Query (tenant-scoped repository methods)

Repositories expose tenant-scoped methods: `findByIdAndShop(id, shopId)`,
`listByShop(shopId, …)`, `findQueuedByShop(shopId, …)`,
`findByIdAndOrderAndShop(orderId, shopId)`. Handlers always pass the
principal's shopId. A handler that calls `findById(id)` without a
shopId filter would bypass this layer — see FIND-018.

Evidence: `src/lib/repositories/order.repository.ts`,
`src/lib/repositories/print-job.repository.ts`, etc.

### Layer 3 — Mutation (conditional updates + audit log)

Mutations use conditional `WHERE` clauses:
`repos.orders.transitionStatus(id, shopId, fromStatus, toStatus)` only
flips status if the current row matches `shopId AND status=fromStatus`
(ARCH-001 fix — `src/app/api/v1/shops/me/orders/[id]/start/route.ts:18-22`).
This prevents double-click double-flips AND cross-shop mutation in a
single SQL statement.

Plus every mutation writes an `AuditLog` row with the principal's
`shopId` and `userId` for after-the-fact forensics.

## 5. Rate limits (per endpoint)

Verified from source. Limits are `limit/windowSeconds`.

### 5.1 Public (no auth)

| Endpoint | Limit |
|---|---|
| `GET /api/v1/health` | none |
| `HEAD /api/v1/health` | none |
| `GET /api/v1/db-health` | none (FIND-011) |
| `GET /api/v1/ready` | 30/60s |
| `GET /api/v1/qr` | 60/60s |
| `GET /api/v1/shops` | 60/60s |
| `GET /api/v1/shops/:slug` | 60/60s |
| `GET /api/v1/shops/:slug/upi-qr` | 60/60s |
| `POST /api/v1/shops/:slug/orders` | 20/60s |
| `GET /api/v1/payments/upi/verify/:orderId` | 60/60s |
| `GET /api/v1/downloads/native-printer` | none (cached 1h via `revalidate`) |
| `GET /api/route` (root) | none |
| `POST /api/v1/payments/phonepe/webhook` | none (webhook-sig) |
| `POST /api/v1/payments/paytm/callback` | none (webhook-sig) |
| `POST /api/v1/auth/refresh` | none (FIND-013) |
| `GET /api/v1/admin/access-check` | none (`?key=`) |
| `POST /api/v1/setup-database` | none (`?key=`) |
| `GET /api/v1/cron/cleanup` | none (`CRON_SECRET`) |

### 5.2 Customer (order token)

| Endpoint | Limit |
|---|---|
| `GET /api/v1/orders/:id/status` | 120/60s |
| `GET /api/v1/orders/:id/receipt` | none (FIND-027) |
| `POST /api/v1/orders/:id/checkout` | 20/60s |
| `POST /api/v1/orders/:id/files` | 30/60s |
| `POST /api/v1/orders/:id/files/upload-url` | 30/60s |
| `PATCH /api/v1/orders/:id/files/:fileId` | 60/60s |

### 5.3 Owner/staff (JWT)

| Endpoint | Limit |
|---|---|
| `POST /api/v1/auth/login` | 20/60s |
| `POST /api/v1/auth/register` | 5/60s |
| `GET /api/v1/auth/register/check-slug` | 30/60s |
| `GET /api/v1/shops/me/payment-credentials` | 30/60s |
| `PUT /api/v1/shops/me/payment-credentials` | 10/60s |
| `DELETE /api/v1/shops/me/payment-credentials` | 10/60s |
| `POST /api/v1/shops/me/payment-credentials/activate` | 10/60s |
| All other `/api/v1/shops/me/*` | none at route level |

> FIND-030 (P1): The bulk of owner-facing `/shops/me/*` routes have
> **no rate limit** at the route level. They rely on the JWT being
> hard to forge. With `CACHE_PROVIDER=memory` on Vercel (FIND-006),
> per-invocation rate limiting wouldn't help anyway, but the routes
> don't even attempt it. An attacker who steals a JWT can hammer
> `/shops/me/analytics`, `/shops/me/orders` etc. unbounded.

### 5.4 Device (device token)

| Endpoint | Limit |
|---|---|
| All `/api/v1/agents/*` and `/api/v1/sync/*` | none |

Devices are expected to poll (`/agents/jobs/pending` every few seconds),
so per-route rate limits would be counter-productive. The defense is
the device-token's secrecy + revocation via `DELETE /api/v1/agents/:id`.

### 5.5 Dev-only

| Endpoint | Limit |
|---|---|
| `GET /api/v1/dev/qr` | 60/60s + `requireDev` |
| `GET /api/v1/dev/seed` / `POST` | 5/60s + `requireDev` |
| `POST /api/v1/dev/orders/:id/mark-paid` | 20/60s + `requireDev` |
| `POST /api/v1/payments/dev/phonepe/simulate` | 20/60s + `requireDev` |
| `POST /api/v1/payments/dev/paytm/simulate` | 20/60s + `requireDev` |
| `PUT /api/v1/storage/put` | none + `requireDev` + HMAC capability |
| `GET /api/v1/storage/get` | none + `requireDev` + HMAC capability |

## 6. Summary

- 3 independent auth systems (JWT, device token, order token) — well-isolated.
- 5 roles (owner, staff, admin, customer, device) — only owner/admin/customer/device reachable today; staff exists in enum but has no human onboarding path (FIND-025).
- 3-layer tenant isolation (auth → query → mutation) — defense-in-depth is real.
- 24 customer-facing endpoints behind `withOrderAccess` (constant-time token compare).
- 6 admin endpoints behind `withAuth(['admin'])`.
- Rate limits are present on most public/auth endpoints but missing on
  `/auth/refresh`, `/orders/:id/receipt`, all device routes, and most
  `/shops/me/*` routes (FIND-013, FIND-027, FIND-030).
- The biggest authorization risks are FIND-028 (no per-route owner/staff
  distinction) and FIND-026 (admin actions are not audit-logged with a
  userId).

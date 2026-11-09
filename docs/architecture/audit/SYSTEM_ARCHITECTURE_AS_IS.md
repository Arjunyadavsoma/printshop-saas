# SYSTEM_ARCHITECTURE_AS_IS

Audit Date: 2025-11-09 · Branch: `main` · Commit: `dc24f4b`

This document captures the **as-is** runtime architecture of PrintShop SaaS,
as verified by reading source files. No opinions, no "should be" — only
what the code does today.

---

## 1. Topology

```
                         ┌──────────────────────────────────┐
                         │  Browser (customer / shopkeeper) │
                         │  Next.js App Router pages (19)   │
                         └───────────────┬──────────────────┘
                                         │ HTTPS + JWT / order-token
                                         ▼
                         ┌──────────────────────────────────┐
                         │  Vercel serverless (region bom1) │
                         │  Next.js 16 App Router (70 v1    │
                         │  API routes under /api/v1/*)     │
                         │  src/middleware.ts (CSP, Edge)   │
                         └─────┬───────┬─────────────┬──────┘
                               │       │             │
                PostgreSQL     │       │ Socket.IO   │ Object storage
                (Supabase      │       │ HTTP emit   │ (Supabase / R2 / S3)
                 free tier)    │       │ → :3004     │
                               ▼       ▼             ▼
                  ┌──────────────┐  ┌────────────┐  ┌──────────────┐
                  │  Prisma 6    │  │ realtime-  │  │  @aws-sdk/   │
                  │  adapter     │  │ service    │  │  client-s3 / │
                  │  (src/lib/   │  │ (Bun,      │  │  supabase-js │
                  │   db.ts)     │  │  port 3004)│  │              │
                  └──────────────┘  └──────┬─────┘  └──────────────┘
                                          │ ws / wss
                                          ▼
                              ┌──────────────────────┐
                              │  Dashboard client    │
                              │  + Print agent (Bun) │
                              └──────────────────────┘
```

Plus auxiliary: GitHub Actions cron (every 5 min) → `/api/v1/cron/cleanup`.

## 2. Adapter pattern (the load-bearing wall)

Every cross-cutting concern (DB, storage, payment, realtime, cache, queue,
email, SMS, logger, auth) is accessed through an interface defined in
`packages/core/src/interfaces/*.adapter.ts` and a concrete resolved in
`src/lib/container.ts`. Business logic (routes, repositories, services)
imports **only the interface** — never a concrete class. The container is
the composition root: the only module that knows which concrete is wired up.

> "Swapping any provider is a one-line env-var change here; business logic
> never edits. This is the load-bearing wall of the whole architecture."
> — `src/lib/container.ts:1-8`

### 2.1 Adapter table

| Concern | Interface | Concrete options | Env selector | Default in prod |
|---|---|---|---|---|
| **Database** | `DatabaseAdapter` (`packages/core/src/interfaces/database.adapter.ts`) | `PrismaDatabaseAdapter` (`src/lib/adapters/prisma-database.adapter.ts`), `InMemoryDatabaseAdapter` (`packages/adapters/src/database/in-memory.adapter.ts`), `SupabaseDatabaseAdapter` (`packages/adapters/src/database/supabase.adapter.ts` — present but unused) | `DATABASE_PROVIDER` (`prisma` \| `memory`) | `prisma` |
| **Storage** | `StorageAdapter` (`packages/core/src/interfaces/storage.adapter.ts`) | `SupabaseStorageAdapter`, `S3StorageAdapter`, `R2StorageAdapter`, `DisabledStorageAdapter`, `InMemoryStorageAdapter` | `STORAGE_PROVIDER` (`supabase` \| `s3` \| `r2` \| `disabled` \| `memory`) | `supabase` (falls back to `disabled` if creds missing) |
| **Payment** | `PaymentAdapter` (`packages/core/src/interfaces/payment.adapter.ts`) | `UpiDeepLinkPaymentAdapter` (default), `PhonePePaymentAdapter`, `PaytmPaymentAdapter` + `PaymentAdapterRegistry` (per-shop routing) | `shop.paymentProvider` (DB column, per-shop) | `googlepay` (UPI deep-link) |
| **Realtime** | `RealtimeAdapter` (`packages/core/src/interfaces/realtime.adapter.ts`) | `SocketIoRelayRealtimeAdapter` (HTTP emit to `:3004`), `InMemoryRealtimeAdapter` | `REALTIME_PROVIDER` (`socketio` \| `memory`) | **`memory` in Vercel env** (per `vercel.json:10`), `socketio` on Render |
| **Cache** | `CacheAdapter` (`packages/core/src/interfaces/cache.adapter.ts`) | `UpstashCacheAdapter` (`@upstash/redis`), `InMemoryCacheAdapter`, `ConstrainedMemoryAdapter` (capped LRU) | `CACHE_PROVIDER` (`redis` \| `memory`) | **`memory` in Vercel env** (per `vercel.json:11`) |
| **Auth** | `AuthAdapter` (`packages/core/src/interfaces/auth.adapter.ts`) | `JwtAuthAdapter` (HS256 + PBKDF2, WebCrypto) — only one concrete | hardcoded | `jwt` |
| **Queue** | `QueueAdapter` | `InMemoryQueueAdapter` only | hardcoded | `memory` |
| **Email** | `EmailAdapter` | `StubEmailAdapter` only | hardcoded | `stub` |
| **SMS** | `SMSAdapter` | `StubSmsAdapter` only | hardcoded | `stub` |
| **Logger** | `LoggerAdapter` | `JsonConsoleLogger`, `StubLoggerAdapter` | `LOGGER_PROVIDER` (`json` \| `stub`) | `json` |

> FIND-005 (P1): Production `REALTIME_PROVIDER=memory` (per `vercel.json:10`).
> This means realtime events are pushed **in-process** on each Vercel
> serverless invocation — they never reach the standalone
> `mini-services/realtime-service` Bun relay, and they never reach a
> browser dashboard via WebSocket. Any client subscribing to Socket.IO
> on the dashboard will NOT receive events from API calls on Vercel.
> The dashboard's live-update feature is therefore **silently broken**
> in production. To make it work, `REALTIME_PROVIDER=socketio` must be
> set AND the `realtime-service` must be hosted somewhere reachable
> (Render, Fly.io, Railway — not Vercel Hobby).

> FIND-006 (P1): Production `CACHE_PROVIDER=memory` (per `vercel.json:11`).
> The container no longer throws on this (`validateCacheProvider` warns
> and continues — `src/lib/container.ts:137-153`), accepting that rate
> limiting is per-invocation. Cross-instance idempotency on payment
> webhooks is guarded by DB UNIQUE constraints (`Order.paymentTxnId`,
> `PaymentEvent(provider,eventId)`), so the **authoritative** guard
> survives. But brute-force rate-limiting on `/auth/login`, order
> token brute force, etc. is per-instance.

> FIND-007 (P2): Only one `AuthAdapter` concrete exists (`JwtAuthAdapter`).
> The architecture is interface-based and the swap is mechanically easy,
> but no second concrete (e.g. argon2id-backed) has been written. The
> comment in `src/lib/auth/jwt-auth.adapter.ts:34-37` acknowledges
> argon2id is the production target.

## 3. The three auth systems

PrintShop SaaS uses **three separate, independent auth mechanisms**,
each with its own verifier and token format. They are documented in
`src/lib/api/with-auth.ts` and `src/lib/api/with-order-access.ts`.

### 3.1 JWT (owner / staff / admin) — `withAuth`

- Verifier: `JwtAuthAdapter.verifyAccessToken` (HS256, WebCrypto).
- Header: `Authorization: Bearer <jwt>`.
- Claims: `{ sub, shopId, role }`.
- TTL: access 900 s, refresh 2 592 000 s (30 d) per `src/lib/container.ts:320-321`.
- On each request: `withAuth` re-fetches the User from DB and rejects
  if the JWT's `shopId` differs from the user's current `shopId`
  (defends against stale tokens after a shop reassignment —
  `src/lib/api/with-auth.ts:73-76`).
- Roles: `owner`, `staff`, `admin` (`packages/core/src/domain/enums.ts`).
- `withAuth(handler, allowedRoles?)` enforces RBAC; admin routes pass
  `['admin']` as the second argument (verified in `src/app/api/v1/admin/**`).

### 3.2 Device token (print agents) — `withDeviceAuth`

- Token format: opaque random string, minted once at `POST /api/v1/agents/register`
  (`src/app/api/v1/agents/register/route.ts:20`).
- Storage: only `SHA-256(token)` is persisted as `PrintAgent.tokenHash`
  (the plaintext is returned once and never stored).
- Verifier: `withDeviceAuth` hashes the bearer token with `HMAC-SHA256`
  using the literal salt `'print-agent-salt'`
  (`src/lib/api/with-auth.ts:116`) and looks up
  `printAgent.findByTokenHash`. On every authenticated call, the agent's
  `lastSeenAt` + `isOnline` are refreshed.
- Tenant scope: `agent.shopId` is the tenant — never derived from query
  string.

> FIND-008 (P2): The device-token HMAC uses a **hardcoded salt**
> `'print-agent-salt'` (`src/lib/api/with-auth.ts:116`). Since the
> stored hash is already a secret comparison (only the agent that
> knows the plaintext can produce the matching hash), this is not a
> security hole per se — but the salt should be a per-deployment env
> var (`AGENT_TOKEN_SALT`) so that a stolen DB dump doesn't enable
> offline hash cracking across deployments.

### 3.3 Order token (customer) — `withOrderAccess`

- Token format: opaque random string generated by
  `generateOrderToken()` (`packages/utils/src/ids.ts`), persisted as
  `Order.customerToken`.
- Sent via `X-Order-Token` header (preferred) OR `?t=` query (fallback
  for receipt URLs that open as navigations).
- Verifier: `withOrderAccess` constant-time-compares the presented
  token against `order.customerToken`
  (`src/lib/api/with-order-access.ts:43-47`).
- On mismatch → 403 (NOT 404 — deliberately hides order existence from
  IDOR attackers — `src/lib/api/with-order-access.ts:27-28`).
- This is the SEC-001 fix documented in
  `src/lib/api/with-order-access.ts:11-22`.

## 4. Storage adapter resolution

`src/lib/container.ts:247-265` implements **graceful storage init**:
if the configured provider's credentials are missing (e.g. Supabase
URL not set), the container falls back to `DisabledStorageAdapter`
rather than crashing. Previously a missing `SUPABASE_URL` would throw
in the `SupabaseStorageAdapter` constructor → every API request
returned 500, including `/auth/register` (which doesn't need storage).
Now: file upload/download returns a clear error, everything else works.

Presigned URLs are the upload/download path in production:
- `POST /api/v1/orders/:id/files/upload-url` returns a Supabase/R2/S3
  presigned PUT URL (the browser uploads directly to the object store,
  not through the Next.js function).
- `GET /api/v1/shops/me/orders/:id/files/:fileId/print-url` returns a
  60-second presigned GET URL for the shopkeeper's browser to fetch
  bytes for the PrintLatch agent.
- The `/api/v1/storage/put` and `/api/v1/storage/get` routes are
  **dev-only** — gated by `requireDev()` and returning 404 in
  production (`src/app/api/v1/storage/put/route.ts:15`,
  `src/app/api/v1/storage/get/route.ts:15`).

## 5. Payment adapter resolution

A `PaymentAdapterRegistry` (`src/lib/payments/registry.ts`) routes
each checkout to the **shop's configured provider**:
`shop.paymentProvider` ∈ `{googlepay, phonepe, paytm}`. The default
container `payment` is `UpiDeepLinkPaymentAdapter` (the UPI deep-link
path used by `googlepay` shops); PhonePe/Paytm shops use the registry
to route to the corresponding concrete at checkout time.

Webhooks land on:
- `POST /api/v1/payments/phonepe/webhook` (v1 X-VERIFY + v2 SHA-auth,
  auto-detected — `src/app/api/v1/payments/phonepe/webhook/route.ts:49-69`)
- `POST /api/v1/payments/paytm/callback` (form-urlencoded + CHECKSUMHASH,
  renders an HTML response — `src/app/api/v1/payments/paytm/callback/route.ts:6-7`)
- `GET /api/v1/payments/upi/verify/[orderId]` — **polling fallback**
  for UPI deep-link (no webhook exists for UPI; the customer's
  browser polls this every few seconds).

Durable persistence: every webhook creates a `PaymentEvent` row
(uniquely keyed by `(provider, eventId)` for dedup) and updates the
parent `PaymentAttempt` row. The `merchantOrderId → orderId` mapping
lives in `PaymentAttempt` (not just in cache) so delayed webhooks
(>10 min) still resolve.

## 6. Realtime flow

In dev / single-process: `InMemoryRealtimeAdapter` is a simple
EventEmitter; the dashboard subscribes via `socket.io` on the same
process. Works locally.

In production on Render (`render.yaml`): the API makes HTTP POST
`/emit` calls to the `realtime-service` Bun process (port 3004), which
broadcasts to connected dashboard clients over WebSocket. The emit
secret is `REALTIME_EMIT_SECRET`, validated via
`requireSecret('REALTIME_EMIT_SECRET')` (`src/lib/container.ts:299`).

In production on Vercel (`vercel.json:10`): `REALTIME_PROVIDER=memory`
— emits go nowhere. See FIND-005.

## 7. Composition root singleton

`getContainer()` (`src/lib/container.ts:191`) caches the container on
`globalThis.__printshopContainer` so it survives across route-handler
module re-evaluations in the Next.js dev runtime. On first call it
also fire-and-forgets `recoverStaleJobsOnStartup()` which:
1. flips `printing` jobs older than 5 min back to `needs_review`
   (`src/lib/services/durable-queue.ts`), and
2. deletes `AuditLog` rows older than 30 days (Neon free-tier 0.5 GB
   ceiling — `src/lib/container.ts:378-385`).

> FIND-009 (P2): On Vercel serverless, every cold start triggers a
> new `getContainer()` call. The `globalThis.__printshopContainer`
> guard only persists **within a single warm invocation**. After a
> cold start the startup maintenance runs again (the function-level
> `staleRecovered` boolean at `src/lib/container.ts:366` is the only
> guard, and it's module-scoped — it resets on cold start). This is
> acceptable (stale recovery is idempotent) but it means every cold
> start pays an extra DB round-trip for the audit-log prune.

## 8. Edge vs Node runtime split

| Surface | Runtime | Evidence |
|---|---|---|
| `src/middleware.ts` | Edge (CSP + security headers) | `src/middleware.ts:1` (no `export const runtime`) |
| All `/api/v1/*` route handlers | Node (default App Router) | no `export const runtime = 'edge'` found |
| `/api/v1/downloads/native-printer` | Node explicitly | `src/app/api/v1/downloads/native-printer/route.ts:37` (`export const runtime = 'nodejs'`) |
| `/api/v1/cron/cleanup` | Node (uses `db`, `processCleanupTasks`) | implicit |

## 9. As-is summary

The architecture is genuinely portable (interface-based, env-selected
adapters) and the composition root is clean. The two real weaknesses
at the as-is layer are:

1. The two stateful adapters (`realtime`, `cache`) are wired to
   **in-memory** in production on Vercel — the platform doesn't host
   long-lived processes, so any feature depending on them is silently
   degraded. (FIND-005, FIND-006)
2. The three auth systems are independent and well-isolated, but the
   device-token salt is hardcoded and there is only one `AuthAdapter`
   concrete (PBKDF2 — argon2id not yet implemented). (FIND-007, FIND-008)

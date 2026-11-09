# PrintShop Unified Platform — Target System Architecture

> Target architecture for the unified platform: one cloud backend, one website, one Windows app (PrintEXE), future Android (consumer + admin). Documents AS-IS vs TO-BE and what can be EXTENDED vs REFACTORED.

**Audit date:** 2025-11-08 · **Commit:** `dc24f4b` · **Branch:** `main`
**Source of truth:** actual source files in `/home/z/my-project`

---

## 1. Target platform topology

| Component | Runtime | Status | Evidence |
|---|---|---|---|
| Cloud backend | Next.js 16 serverless on Vercel (70 API routes) | VERIFIED | `src/app/api/v1/**`, 401/200 prod probes |
| Website (consumer + shopkeeper + admin) | Next.js 16 App Router on Vercel | VERIFIED | `src/app/{shop,admin,orders,shops}/**` |
| Realtime relay | Socket.IO mini-service, separate process | IMPLEMENTED / NOT DEPLOYED | `mini-services/realtime-service/index.ts:1-168` |
| Windows desktop (PrintEXE) | .NET 10 WPF | BLOCKED — protocol incompatible | `docs/DESKTOP_INTEGRATION.md` |
| Android consumer app | Future | NOT STARTED | — |
| Android admin app | Future | NOT STARTED | — |

**The unified platform = one cloud backend, one website, one desktop client family, one mobile client family.** Multiple clients share one tenant model and one auth model.

---

## 2. AS-IS (what exists today)

### 2.1 Cloud backend — VERIFIED
- 14 Prisma models (`prisma/schema.prisma:1-326`); 10 tables live in production
- 70 API routes under `/api/v1/*`
- 3-layer tenant isolation (auth → query → mutation — `src/lib/api/with-auth.ts:52-127`)
- Payment pipeline: PhonePe v1+v2, Paytm, UPI deep-link, cash-on-pickup
- Print-agent protocol: device-token auth, atomic job claiming, presigned-URL delivery
- Sync endpoints: `GET /api/v1/sync/pull`, `POST /api/v1/sync/push`, `GET /api/v1/sync/status` (all 401 without device token — VERIFIED)

### 2.2 Website — VERIFIED
- 21 pages, all using semantic design tokens
- Customer: `/orders/[id]`, `/shops/[slug]`
- Shopkeeper: `/shop/{dashboard,orders,settings,reports,printer}`
- Admin: `/admin/{orders,shops,analytics,monitoring}`

### 2.3 Realtime relay — IMPLEMENTED but NOT DEPLOYED
- `mini-services/realtime-service/index.ts:1-168` — two-port Socket.IO + HTTP `/emit` relay
- Production target: Render/Railway (Vercel serverless can't host long-running sockets)
- Status: KNOWN_LIMITATIONS P1-3

### 2.4 Windows desktop — BLOCKED
- PrintEXE exists in a private repo but uses INCOMPATIBLE protocol (see `PRINTEXE_CONTRACT_AUDIT.md`)
- 7 specific contract mismatches identified
- Must adapt before any production use

---

## 3. TO-BE (target state)

### 3.1 Subscription-gated multi-tenant SaaS
- First 100 shops = launch cohort (free access, admin-selected)
- Paid plans from launch
- Central administrator toggles `Shop.subscriptionTier` per shop
- `requireEntitlement('feature')` middleware gates routes (currently NOT IMPLEMENTED — `Subscription` model vestigial)

### 3.2 Durable payment pipeline
- `PaymentAttempt` model replaces cache-only session lookup (`src/lib/payments/webhook.service.ts:27-35` — TODO comments at lines 167, 215 in `phonepe-v2-webhook.ts`)
- DB-backed merchantOrderId→orderId mapping survives Vercel cold starts + delayed webhooks (>10 min)

### 3.3 Always-on realtime
- Deployed to Render/Railway (not Vercel)
- Caddy gateway `?XTransformPort=3003` exposes Socket.IO on the apex domain
- JWT-verified room joins (`shop:<shopId>` scoping — `mini-services/realtime-service/index.ts:91-114`)

### 3.4 PrintEXE protocol adaptation
- PrintEXE adopts SaaS contract (one-way change — see `PRINTEXE_CONTRACT_AUDIT.md`)
- Server-side change set is minimal (mostly extend, not refactor)

### 3.5 Android (post-desktop)
- Consumer app: order tracking, payment, file upload
- Admin app: shop management, analytics, agent/device management
- API prerequisites must be locked BEFORE Android work starts

---

## 4. Extension vs refactor decision matrix

| Area | Decision | Rationale | Evidence |
|---|---|---|---|
| Auth model (JWT + device token + order token) | KEEP + EXTEND | 3-tier model already supports all client types | `src/lib/api/with-auth.ts:52-159` |
| Tenant isolation (3-layer) | KEEP | No known bypass | `src/lib/repositories/*.ts` filter by `shopId` |
| Payment pipeline | EXTEND | Add `PaymentAttempt` lookup alongside cache (graceful migration) | `webhook.service.ts:27-35` |
| Print-agent protocol | KEEP | PrintEXE must adapt (1-way) | `PRINTEXE_CONTRACT_AUDIT.md` |
| Realtime relay | KEEP + DEPLOY | Code complete; needs hosting move | `mini-services/realtime-service/` |
| Subscription model | REFACTOR | `Subscription` model vestigial — wire it or remove it | `schema.prisma:161-173`, zero repos use it |
| Reports | EXTEND | Add 7-value separation + refund tracking | `FINANCIAL_REPORTING_AUDIT.md` |
| Sync protocol | KEEP | Bidirectional cursor sync already designed | `docs/SYNC_PROTOCOL.md` |
| Customer delivery tracking UI | EXTEND | `PrintDeliveryAttempt` model exists; UI not built | `docs/KNOWN_LIMITATIONS.md` P2-7 |

---

## 5. P0/P1 architecture blockers

| ID | Blocker | Severity | Affects |
|---|---|---|---|
| ARCH-001 | PrintEXE protocol incompatible | P0 | Desktop launch |
| ARCH-002 | Subscription entitlements not enforced | P1 | Business model |
| ARCH-003 | `PaymentAttempt` not wired (cache-only webhook lookup) | P1 | Delayed webhook reliability |
| ARCH-004 | Realtime service not deployed | P1 | Dashboard UX, dispatch latency |
| ARCH-005 | 4 new tables missing from prod DB (DeviceSyncState, Customer, PrintDeliveryAttempt, FileCleanupTask) | P1 | Delivery tracking, sync, cleanup |
| ARCH-006 | `migration_lock.toml` says sqlite, prod is postgresql | P0 | Future migrations |
| ARCH-007 | `CRON_SECRET` not configured | P1 | File cleanup automation |
| ARCH-008 | Customer delivery tracking UI not built | P2 | UX |
| ARCH-009 | Android API contracts not yet locked | P2 | Android prerequisites |

---

## 6. Cross-cutting principles (must hold across all clients)

1. **Server is the sole financial authority** (`docs/FINANCIAL_BUSINESS_LOGIC.md:13`)
2. **All clients use the same auth model** (JWT for users, device token for agents, order token for customers)
3. **No client owns business data** — desktop SQLite is transit cache only (`docs/DESKTOP_INTEGRATION.md:117-128`)
4. **Tenant isolation is enforced at 3 layers** — never trusted at the client
5. **All money is integer paise** — no floats
6. **All webhooks are signature-verified** — fail-closed if env vars unset

---

## 7. Android API prerequisites (must be locked BEFORE Android dev)

1. `/api/v1/auth/login` and `/api/v1/auth/refresh` — JWT issuance + rotation (DONE)
2. `/api/v1/me` — current-user profile (DONE)
3. `/api/v1/shops/{slug}` — public shop discovery (DONE)
4. `/api/v1/orders/{id}/*` — customer order flow (DONE — order-token auth)
5. `/api/v1/shops/me/*` — shopkeeper dashboard (DONE)
6. `/api/v1/admin/analytics` — admin metrics (DONE)
7. Push notification endpoint — NOT BUILT (Android consumer needs FCM relay)
8. File upload from mobile (multipart + presigned PUT) — VERIFIED via existing storage routes
9. Receipt download with `?t=` token — DONE

The Android contract is mostly the existing API surface. New work is limited to FCM push registration + token management.

---

## 8. Conclusion

The architecture is **structurally correct and mostly built**. The blockers are operational, not architectural:

- PrintEXE needs protocol adaptation (1-way, server unchanged for 5 of 7 fixes)
- Subscription model needs wiring (or removal)
- PaymentAttempt needs wiring (cache → DB lookup)
- Realtime needs deployment (Render/Railway)
- 4 tables need DB migration (user-approved)

No rewrite. No platform migration. **Extend, don't refactor.**

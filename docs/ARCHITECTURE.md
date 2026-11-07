# PrintShop Unified Platform — Architecture

> The single source of truth for the PrintShop platform architecture: one
> business platform, two clients (web SaaS + Windows desktop), one shared
> backend, one canonical data model.

**Status:** v1.0 — 2025-11-07. Based on a complete audit of both repositories:
- PrintShop SaaS: `/home/z/my-project` (Next.js 16, commit `c933548`)
- PrintEXE Windows client: `github.com/Arjunyadvsoma/PrintEXE` (.NET 10 / WPF)

---

## 1. Platform identity

PrintShop is **one business platform** with two client surfaces:

| Client | Tech | Repo | Role |
|---|---|---|---|
| **PrintShop SaaS** (web) | Next.js 16 + React 19 + Prisma + Supabase Postgres | `Arjunyadvsoma/printshop-saas` | The reference implementation. Hosts the shared backend, customer portal, shopkeeper dashboard, admin portal. |
| **PrintEXE** (Windows desktop) | .NET 10 / WPF | `Arjunyadvsoma/PrintEXE` | A first-class API client of the SaaS backend. Handles local printing, offline job queue, shopkeeper operations on Windows. |

**The web app is the authoritative backend. The desktop app is a client.**
The desktop never owns business data — it syncs with the backend.

---

## 2. Current state (honest assessment)

### 2.1 What exists and works (PrintShop SaaS)

- ✅ Multi-tenant SaaS with 10 Prisma models (Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription, AuditLog, PaymentAttempt, PaymentEvent)
- ✅ 60 API routes across 10 domains (auth, shops, orders, payments, agents, admin, storage, dev, health, downloads)
- ✅ Custom JWT auth (HS256, PBKDF2 passwords, 15-min access + 30-day refresh tokens)
- ✅ Three auth guards: `withAuth` (JWT), `withDeviceAuth` (print-agent HMAC token), `withOrderAccess` (customer per-order token)
- ✅ Payment pipeline: PhonePe v1+v2, Paytm, UPI deep-link fallback — webhook signature verification, idempotency, race-safe state transitions
- ✅ Print agent infrastructure: REST polling + socket.io push, atomic job claiming, stale recovery
- ✅ Realtime via socket.io mini-service (port 3003) + HTTP /emit relay (port 3004)
- ✅ File storage: R2 / S3 / Supabase / in-memory (adapter-selected)
- ✅ 234 unit/integration tests, Playwright smoke test
- ✅ Design system: semantic OKLCH tokens, 49 shadcn components, all 21 pages migrated

### 2.2 What exists but is vestigial (not wired)

- ⚠️ `Subscription` model (schema exists, zero code references — tier read from `Shop.subscriptionTier` instead)
- ⚠️ `PaymentAttempt` + `PaymentEvent` models (schema exists, webhook pipeline still uses cache-only session lookup)
- ⚠️ `next-auth` package (installed but unused — auth is custom JWT)
- ⚠️ Entitlements enforcement (absent — no feature gating anywhere)

### 2.3 What's missing (for unified platform)

- ❌ Bidirectional sync endpoints (`/api/v1/sync/*`)
- ❌ Device registration with sync cursor state
- ❌ Revision/version fields on models (for conflict detection)
- ❌ Desktop-specific API contract (PrintEXE uses incompatible protocol)

### 2.4 PrintEXE current state

- ✅ .NET 10 / WPF app with 6-project solution
- ✅ SQLite durable job queue with crash-replay, exponential backoff, corrupt-DB recovery
- ✅ DPAPI-encrypted device token storage
- ✅ SumatraPDF + raw GDI printer rendering
- ✅ Socket.IO client + HTTP polling fallback
- ❌ **Wire protocol is INCOMPATIBLE with the real SaaS backend** (see §4)
- ❌ Has never been compiled or tested on Windows hardware
- ❌ Magic-link pairing flow doesn't exist server-side
- ❌ The SaaS repo has zero references to PrintEXE

---

## 3. Target architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SHARED BACKEND                                │
│  PrintShop SaaS (Next.js 16) — the authoritative data source         │
│                                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │ Customer    │  │ Shopkeeper   │  │ Admin       │  │ API       │ │
│  │ Portal      │  │ Dashboard    │  │ Portal      │  │ Routes    │ │
│  │ (web)       │  │ (web)        │  │ (web)       │  │ /api/v1/* │ │
│  └─────────────┘  └──────────────┘  └─────────────┘  └───────────┘ │
│                                                       ║             │
│  ┌─────────────────────────────────────────────────────╫──────────┐ │
│  │ Business Logic (packages/core)                       ║          │ │
│  │  • Pricing engine  • Order state machine             ║          │ │
│  │  • Payment verification  • Tenant isolation          ║          │ │
│  │  NEVER imports concrete adapters (interface-only)    ║          │ │
│  └─────────────────────────────────────────────────────╫──────────┘ │
│                                                       ║             │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ ║ ┌────────┐ │
│  │ Database   │ │ Storage  │ │ Payment  │ │Realtime │ ║ │ Sync   │ │
│  │ Adapter    │ │ Adapter  │ │ Adapter  │ │Adapter  │ ║ │Engine  │ │
│  └─────┬──────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ ║ └───┬────┘ │
│        │              │            │            │       ║     │      │
│   Supabase PG     R2/S3       PhonePe/Paytm   Socket.IO ║  Delta   │
│   (shared DB)     (shared)     (webhooks)      (port 3003)║ queries │
└─────────────────────────────────────────────────────────╫──────────┘
                                                          ║
                    ┌─────────────────────────────────────╫──────┐
                    │        SHARED API CONTRACT          ║      │
                    │  /api/v1/* (versioned, documented)  ║      │
                    │  Auth: JWT + device token + order   ║      │
                    └────────┬───────────────────────────╫──────┘
                             │                            ║
              ┌──────────────┼───────────────────────────╫──────┐
              │              │                           ║      │
              ▼              ▼                           ▼      ▼
        ┌──────────┐  ┌──────────────┐          ┌────────────────────┐
        │ Customer │  │ Shopkeeper   │          │ PrintEXE           │
        │ (browser)│  │ (browser)    │          │ (Windows desktop)  │
        │          │  │              │          │                    │
        │ Upload,  │  │ Dashboard,   │          │ Local printing,    │
        │ pay UPI, │  │ orders,      │          │ offline queue,     │
        │ track    │  │ settings     │          │ sync, operations   │
        └──────────┘  └──────────────┘          └────────────────────┘
              │              │                           │
              │ WebSocket    │ WebSocket                 │ REST + WebSocket
              │ (socket.io)  │ (socket.io)               │ + SQLite cache
              ▼              ▼                           ▼
        ┌─────────────────────────────────────────────────────────────┐
        │              REALTIME LAYER (socket.io :3003)                │
        │  Events: order.paid, job.dispatch, job.printing,             │
        │  job.completed, order.ready, sync.* (future)                 │
        └─────────────────────────────────────────────────────────────┘
```

### Key principles

1. **One backend, one database.** The SaaS Postgres is the single source of truth. The desktop never owns business data.
2. **Adapter pattern invariant.** Business logic (`packages/core`) imports interfaces only — never concrete adapters. Swapping Supabase → self-hosted Postgres is a one-line config change.
3. **Server-authoritative financial calculations.** Pricing, taxes, invoice totals, payment verification all happen server-side. The desktop displays results, never computes them independently.
4. **Strict tenant isolation.** Every query filters by `shopId` from the JWT principal. The desktop's device token resolves to a `shopId` — same isolation.
5. **The desktop is a sync client, not a standalone app.** It can operate offline (local SQLite job queue) but must sync changes to the backend. The backend is authoritative for conflicts.

---

## 4. The PrintEXE incompatibility (must be resolved)

The audit found that PrintEXE's wire protocol is **incompatible** with the real SaaS backend:

| Concern | PrintEXE expects | SaaS backend provides | Status |
|---|---|---|---|
| Auth header | `X-PrintShop-Device-Token` + `X-PrintShop-Device-Id` | `Authorization: Bearer <deviceToken>` | ❌ Incompatible |
| Pairing | Magic-link URL `printshopcompanion://pair?token=…` | Copy-paste plaintext token from `/api/v1/agents/register` | ❌ Incompatible |
| Register | `POST /pair` with pairing ticket | `POST /api/v1/agents/register` (owner JWT auth) | ❌ Incompatible |
| Heartbeat | `POST /heartbeat` | `POST /api/v1/agents/heartbeat` | ⚠️ Path mismatch |
| Jobs pending | `GET /agents/jobs/pending` | `GET /api/v1/agents/jobs/pending` | ⚠️ Path mismatch |
| Job ack | `POST /jobs/{jobId}/ack` | (no ack route — status report IS the claim) | ❌ Incompatible |
| Status report | `{printedAt, failedAt, errorMessage}` | `{status: 'printing'|'completed'|'failed', lastError, printerName}` | ❌ Incompatible DTO |
| Revoke | `POST /device/revoke` | (no revoke route — delete PrintAgent row) | ❌ Missing |
| Socket.IO events | `DeliverJob`, `AckJob`, `ReportStatus` | `job.dispatch`, `auth`, `auth-ok` | ❌ Incompatible |
| Socket.IO path | `/companion-hub` | `/` (port 3003) | ❌ Incompatible |
| Token → JWT exchange | (not implemented) | `POST /api/v1/agents/token` | ❌ Missing in PrintEXE |

### Resolution path

**Option A (recommended): Adapt PrintEXE to the SaaS contract.**
PrintEXE's `HttpPrintShopBackend.cs` + `SocketIoRealtimeClient.cs` + `CompanionProtocol.cs` must be rewritten to use the real SaaS protocol. This is a PrintEXE-side change — the SaaS backend doesn't change.

**Option B: Add a compatibility layer to the SaaS backend.**
Add `/api/v1/companion/*` routes that translate PrintEXE's protocol to the real internal calls. This adds maintenance burden and a second protocol to support.

**This document recommends Option A.** The SaaS backend is the reference; PrintEXE adapts.

---

## 5. Adapter architecture (preserved from existing SaaS)

The existing adapter pattern is the load-bearing wall of the platform. See `ARCHITECTURE.md` (the original) for the full deep-dive. Summary:

```
packages/core      ← interfaces (no concrete deps)
packages/adapters  ← concretes (depend on core interfaces)
src/app/*          ← compose a concrete at boot, inject it
```

| Adapter | Interface | Concrete options | Selected by |
|---|---|---|---|
| Database | `DatabaseAdapter` | Prisma (Supabase PG), in-memory | `DATABASE_PROVIDER` |
| Storage | `StorageAdapter` | R2, S3, Supabase, in-memory, disabled | `STORAGE_PROVIDER` |
| Payment | `PaymentAdapter` | PhonePe v1/v2, Paytm, UPI deep-link | `Shop.paymentProvider` |
| Realtime | `RealtimeAdapter` | Socket.io relay, in-memory | `REALTIME_PROVIDER` |
| Cache | `CacheAdapter` | Upstash Redis, in-memory | `CACHE_PROVIDER` |
| Queue | `QueueAdapter` | In-memory (PrintJob table is the durable queue) | (always in-memory) |
| Auth | `AuthAdapter` | JWT (HS256 + PBKDF2) | (always JWT) |
| Logger | `LoggerAdapter` | JSON console, stub | `LOGGER_PROVIDER` |

**The desktop client does NOT get its own adapters.** It talks to the SaaS backend's API. The only local persistence is the print-job queue (SQLite, transit-only).

---

## 6. Multi-tenancy

Every model that belongs to a shop has a `shopId` column:
- `Shop` (is the tenant root)
- `User` (nullable `shopId` — admin = null)
- `Order`, `PrintJob`, `PrintAgent`, `Subscription`, `PaymentAttempt` (all have `shopId`)
- `PrintFile` inherits via `order.shopId`
- `AuditLog` (nullable `shopId` — platform events)

**Tenant isolation is enforced at the repository layer** (`src/lib/repositories/*`). Every query filters by `shopId` from the JWT principal or device token. No raw SQL in route handlers.

The desktop client's device token resolves to a `shopId` via `withDeviceAuth` → `PrintAgent.shopId`. Same isolation as web.

---

## 7. Money

All currency is **integer paise** (1 INR = 100 paise) in `Int` columns. The pricing engine (`packages/core/src/pricing/`) operates entirely in paise with half-up rounding. No `float` money anywhere in business logic.

The desktop client must display amounts using `formatINRFromPaise()` — the same formatter the web uses. It must NEVER compute prices locally; it fetches priced orders from the backend.

---

## 8. Realtime

| Component | Location | Role |
|---|---|---|
| socket.io server | `mini-services/realtime-service/index.ts` (:3003) | Fan-out to browser dashboards + print agents |
| HTTP /emit relay | `mini-services/realtime-service/index.ts` (:3004) | Server-to-server push (Next.js → socket.io) |
| Browser client | `src/components/phase5/use-realtime.ts` | Dashboard live updates |
| Print agent client | `mini-services/print-agent/src/agent.ts` | Job dispatch listener |
| PrintEXE client | `PrintEXE/src/.../SocketIoRealtimeClient.cs` | (must be adapted to real protocol) |

**Event vocabulary** (published via `container.realtime.publish(shopChannel(shopId), event, payload)`):

| Event | Payload | Consumers |
|---|---|---|
| `order.paid` | `{orderId, amountPaise}` | dashboard, (future: desktop) |
| `order.ready` | `{orderId}` | dashboard |
| `order.cancelled` | `{orderId, reason}` | dashboard (⚠️ not currently subscribed) |
| `job.dispatch` | `{jobId, fileId, orderId, ...}` | print agent, (future: desktop) |
| `job.printing` | `{jobId, fileId}` | dashboard |
| `job.completed` | `{jobId, fileId}` | dashboard |
| `sync.*` | (future) | (future: desktop sync notifications) |

---

## 9. Deployment topology

| Component | Platform | Current | Target |
|---|---|---|---|
| Web app + API | Vercel (Hobby, Mumbai) | ✅ Live | Keep |
| Realtime service | Render / Vercel | ✅ Live | Keep (or move to Vercel function) |
| Database | Supabase Postgres (pooler :6543) | ✅ Live | Keep |
| Storage | Supabase Storage / R2 | ✅ Live | Keep |
| PrintEXE | Windows desktop | ❌ Not deployed | Per-shop MSI install |

The web app is the deployment hub. The desktop is distributed per-shop via MSI installer.

---

## 10. References

- `docs/DATABASE_SCHEMA.md` — canonical data model
- `docs/API_CONTRACT.md` — versioned API for both clients
- `docs/DESKTOP_INTEGRATION.md` — PrintEXE integration path
- `docs/SYNC_PROTOCOL.md` — bidirectional sync design
- `docs/DESIGN_SYSTEM.md` — visual identity for both clients
- `docs/FEATURE_PARITY.md` — module matrix
- `ARCHITECTURE.md` (original) — adapter pattern deep-dive
- `docs/REDESIGN_AUDIT.md` — file:line audit of the SaaS repo

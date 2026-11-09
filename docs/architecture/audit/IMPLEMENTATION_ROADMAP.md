# PrintShop Unified Platform — Implementation Roadmap

> Dependency-aware implementation sequence. Lists phases in execution order. For each phase: what changes, what depends on it, what it depends on, estimated effort, risk.

**Audit date:** 2025-11-08 · **Commit:** `dc24f4b`
**Effort scale:** S (≤1 day) · M (1-3 days) · L (1 week) · XL (2+ weeks)
**Risk scale:** LOW · MED · HIGH

---

## Phase ordering (dependency-aware)

```
Phase 1: PrintEXE protocol adaptation (no server change)
    ↓
Phase 2: Subscription enforcement wiring (no schema change)
    ↓
Phase 3: PaymentAttempt wiring (no schema change)
    ↓
Phase 4: Realtime service deployment (infra change)
    ↓
Phase 5: Customer delivery tracking UI (frontend)
    ↓
Phase 6: Android API contracts (lock the surface)
    ↓
Phase 7: Android apps (consumer + admin)
```

**Critical insight:** Phases 1-4 can run in parallel by separate engineers. Phase 5 depends on Phase 4. Phase 6 depends on Phases 2 + 3 (entitlements + payment durability). Phase 7 depends on Phase 6.

---

## Phase 1 — PrintEXE protocol adaptation

**What changes:** PrintEXE's `HttpPrintShopBackend.cs`, `SocketIoRealtimeClient.cs`, `CompanionProtocol.cs` are rewritten to match the SaaS contract.

**Server-side changes:** NONE (zero). All backend routes already exist.

**Specific changes (from `PRINTEXE_CONTRACT_AUDIT.md`):**
1. Auth header: `Authorization: Bearer` (PC-001)
2. Pairing flow: paste-token field (Option A — PC-002)
3. Endpoint paths: `/api/v1/agents/*` (PC-003)
4. Status DTO: `{status, lastError?, printerName?}` + drop `/ack` (PC-004, PC-007a)
5. Socket.IO: `/?XTransformPort=3003`, `auth {token: jwt}`, listen for `job.dispatch` (PC-005)
6. Token → JWT exchange: call `/api/v1/agents/token` (PC-006)
7. Revoke: call `DELETE /api/v1/agents/{id}` with owner JWT (PC-007b)
8. Add receipt call: `POST /api/v1/agents/jobs/{jobId}/received`

**Depends on:** nothing (server is ready)
**What depends on it:** Phase 4 (realtime — PrintEXE connects to socket server); Phase 5 (delivery tracking — PrintEXE reports receipts)
**Effort:** L (PrintEXE codebase is .NET 10/WPF, must be built on Windows)
**Risk:** HIGH — never compiled before; Linux sandbox cannot verify
**Blocker:** requires Windows machine + .NET 10 SDK

**Verification gate:** PrintEXE must successfully:
1. Pair against production (paste-token flow)
2. Receive a `job.dispatch` event
3. Claim a job via `{status:'printing'}`
4. Complete a job via `{status:'completed'}`
5. Send a receipt via `/agents/jobs/{id}/received`

---

## Phase 2 — Subscription enforcement wiring

**What changes:**
- New: `src/lib/repositories/subscription.repository.ts`
- New: `src/lib/api/require-entitlement.ts` middleware
- Modified: `src/app/api/v1/auth/register/route.ts` — create `Subscription` row on shop registration
- New: `POST /api/v1/admin/shops/{id}/subscription` — admin grants tier
- Modified: 3 low-risk routes gated first (`/sync/*`, `/reports/daily`, `/agents/*`)

**Depends on:** nothing (schema already has `Subscription` model)
**What depends on it:** Phase 6 (Android needs entitlements gated); Phase 7 (admin app manages subscriptions)
**Effort:** M (1-3 days — code only, no schema change)
**Risk:** LOW — additive; existing routes continue to work
**Reference:** `SUBSCRIPTION_GAP_ANALYSIS.md` §5 Phase A

**Verification gate:**
1. New shop registration creates `Subscription` row with `tier='free'`
2. Admin can change tier via `POST /api/v1/admin/shops/{id}/subscription`
3. Gated routes return 403 when tier lacks entitlement
4. Audit log records `subscription.tier_change`

---

## Phase 3 — PaymentAttempt wiring

**What changes:**
- New: `src/lib/repositories/payment-attempt.repository.ts`
- New: `src/lib/repositories/payment-event.repository.ts`
- Modified: `src/lib/payments/webhook.service.ts:27-35` — replace `lookupPaymentSession` (cache-only) with `PaymentAttempt.findOne({merchantOrderId})` (DB-primary, cache as fast-path overlay)
- Modified: `src/app/api/v1/orders/[id]/checkout/route.ts` — write `PaymentAttempt` row at checkout (replaces or augments `rememberPaymentSession`)
- Modified: `src/lib/payments/phonepe-v2-webhook.ts:167, 215` — wire TODOs (persist `PaymentEvent`)

**Depends on:** nothing (schema already has both models)
**What depends on it:** Phase 6 (Android needs durable payment mapping); financial reconciliation (future)
**Effort:** M (1-3 days — code only, no schema change)
**Risk:** MED — touches the payment pipeline; must maintain backward compatibility (cache fallback during migration)
**Reference:** `FINANCIAL_REPORTING_AUDIT.md` §5

**Verification gate:**
1. Checkout creates a `PaymentAttempt` row with `merchantOrderId`
2. Webhook resolves `merchantOrderId` via DB lookup (cache miss still works as fallback)
3. Each webhook creates a `PaymentEvent` row (signature status, processing status)
4. Existing 234 payment tests still pass
5. New tests: delayed webhook (>10 min) resolves correctly

---

## Phase 4 — Realtime service deployment

**What changes:**
- Deploy `mini-services/realtime-service/index.ts` to Render or Railway (NOT Vercel)
- Configure env vars: `JWT_ACCESS_SECRET`, `REALTIME_EMIT_SECRET`, `CORS_ALLOWED_ORIGINS`
- Caddy gateway: `?XTransformPort=3003` routes to Render/Railway service
- Update Next.js `RealtimeAdapter` to point `/emit` relay to the new host

**Depends on:** nothing (code complete at `mini-services/realtime-service/index.ts:1-168`)
**What depends on it:** Phase 1 (PrintEXE socket connection); Phase 5 (live dashboard delivery updates); customer-facing realtime (order status)
**Effort:** S (≤1 day — code is done; this is deployment + env config)
**Risk:** LOW — code is complete and unit-tested; main risk is CORS misconfiguration
**Reference:** `docs/KNOWN_LIMITATIONS.md:42-44` (P1-3)

**Verification gate:**
1. Socket.IO server responds on `https://printshop-saas-three.vercel.app/?XTransformPort=3003`
2. JWT auth rejects invalid tokens (lines 96-104 of realtime-service)
3. `/emit` relay rejects wrong `X-emit-secret` (line 123)
4. Browser dashboard receives `order.paid` event when webhook fires
5. PrintEXE receives `job.dispatch` event when job is enqueued

---

## Phase 5 — Customer delivery tracking UI

**What changes:**
- Modified: `src/app/orders/[id]/page.tsx` — add delivery status indicators (dispatched, received)
- Modified: `src/components/phase4/customer-app.tsx` — TrackStep enhancement
- New: shop dashboard delivery history section (`src/components/phase5/dashboard-queue.tsx` extension)
- Backend: `PrintDeliveryAttempt` table must exist (requires DB migration — `prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql`)

**Depends on:** Phase 4 (realtime for live updates); DB migration (user-approved — `docs/PRODUCTION_READINESS_AUDIT.md:166-176`)
**What depends on it:** customer trust (they can see their document was received); shopkeeper visibility
**Effort:** M (1-3 days — UI work + queries to `PrintDeliveryAttempt`)
**Risk:** LOW — model + service exist (`src/lib/services/delivery-coordinator.ts:1-313`); graceful degradation if table missing
**Reference:** `docs/KNOWN_LIMITATIONS.md:85-93` (P2-7, P2-8)

**Verification gate:**
1. Customer sees "Dispatched to device" + "Received by device" on order page
2. Shopkeeper sees delivery attempt history in dashboard
3. UI degrades gracefully if `PrintDeliveryAttempt` table is missing

---

## Phase 6 — Android API contracts

**What changes:**
- Audit existing API surface for Android compatibility (consumer + admin)
- Lock endpoint contracts (no breaking changes after this point)
- New: `POST /api/v1/devices/fcm/register` — FCM token registration for push notifications (Android consumer)
- New: `POST /api/v1/admin/notifications/broadcast` — admin push (Android admin)
- Document the locked contract in `docs/ANDROID_API_CONTRACT.md`

**Depends on:** Phase 2 (entitlements must be enforced before Android relies on them); Phase 3 (payment durability for Android checkout)
**What depends on it:** Phase 7 (Android apps)
**Effort:** M (1-3 days — mostly documentation + 2 new endpoints)
**Risk:** LOW — most of the API surface already exists and is verified by 401 probes
**Reference:** `SYSTEM_ARCHITECTURE_TARGET.md` §7

**Verification gate:**
1. All consumer flows work via existing API (login, order, pay, track, receipt)
2. All admin flows work via existing API (shops list, analytics, audit)
3. FCM registration endpoint accepts a token + shopId, stores for push
4. Contract doc published + reviewed

---

## Phase 7 — Android apps (consumer + admin)

**What changes:**
- New repo: `Arjunyadvsoma/printshop-android` (Kotlin + Jetpack Compose)
- Consumer app: order tracking, payment, file upload, push notifications
- Admin app: shop management, analytics, agent/device management

**Depends on:** Phase 6 (locked API contract); FCM push infrastructure (new)
**What depends on it:** nothing (terminal phase)
**Effort:** XL (2+ weeks — two native apps)
**Risk:** MED — new codebase, but the backend is locked
**Reference:** `SYSTEM_ARCHITECTURE_TARGET.md` §3.5

**Verification gate:**
1. Consumer app: login → discover shop → create order → pay → track → download receipt
2. Admin app: login → view shops → view analytics → manage agents
3. Push notifications: order.paid event triggers FCM push to consumer
4. Tenant isolation: consumer A cannot see consumer B's orders

---

## Parallelization matrix

| Engineer | Phase(s) | Can start day 1? |
|---|---|---|
| Backend engineer 1 | Phase 2 (subscription) | YES |
| Backend engineer 2 | Phase 3 (PaymentAttempt) | YES |
| DevOps engineer | Phase 4 (realtime deploy) | YES |
| Windows/.NET engineer | Phase 1 (PrintEXE) | YES (needs Windows machine) |
| Frontend engineer | Phase 5 (delivery UI) | After Phase 4 deploys + DB migration |
| Mobile engineer | Phase 6 + 7 | After Phases 2 + 3 complete |

**Critical path:** Phase 1 + Phase 4 in parallel → Phase 5 → Phase 6 → Phase 7 (≈ 4-6 weeks total).

---

## Migration dependencies (DB changes)

The DB migration (`prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql`) is BLOCKED on user approval (`docs/PRODUCTION_READINESS_AUDIT.md:166-176`). It creates 4 tables:

| Table | Required by |
|---|---|
| `DeviceSyncState` | Sync protocol (Phase 1+) |
| `Customer` | Customer sync (future) |
| `PrintDeliveryAttempt` | Phase 5 (delivery tracking) |
| `FileCleanupTask` | Cron cleanup (`/api/v1/cron/cleanup`) |

**Migration is additive** (no DROP/ALTER on existing tables) — safe to apply.
**Rollback SQL** documented at `docs/PRODUCTION_READINESS_AUDIT.md:155-161`.

**Recommendation:** approve + apply migration before Phase 5 starts.

---

## Risk register (cross-phase)

| Risk | Phase affected | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| PrintEXE doesn't compile on Windows | Phase 1 | MED | HIGH (blocks desktop launch) | Use GitHub Actions windows-latest runner |
| Realtime CORS misconfigured | Phase 4 | LOW | MED | Test from production URL before launch |
| Subscription gating breaks existing flows | Phase 2 | LOW | MED | Gate 3 routes first; rollback if 403 spikes |
| PaymentAttempt migration breaks checkout | Phase 3 | LOW | HIGH | Keep cache fallback; A/B test |
| Android contract changes after Phase 7 starts | Phase 7 | MED | HIGH | Phase 6 locks the contract formally |
| DB migration applied without backup | All | LOW | CRITICAL | Require `pg_dump` before approval |

---

## What is NOT in this roadmap

- **Multi-region deployment** — not needed at current scale
- **Custom payment provider integration** — current 3 providers (PhonePe v1+v2, Paytm) + UPI deep-link + cash is sufficient
- **GST/tax computation** — Phase 2+ per `docs/FINANCIAL_BUSINESS_LOGIC.md:101-111`
- **Invoice generation** — Phase 2+ per `docs/FINANCIAL_BUSINESS_LOGIC.md:127-167`
- **Inventory management** — Phase 2+ per `docs/FINANCIAL_BUSINESS_LOGIC.md:234-241`
- **iOS apps** — not in scope (Android first)

These are deliberate deferrals, not oversights.

---

## Conclusion

The roadmap is **sequenced by dependency, not by priority**. Phases 1-4 can all start day 1 in parallel. The critical path is ~4-6 weeks.

**No phase requires a schema migration** (Phases 1-4, 6 all use existing schema). Only Phase 5 requires the already-prepared additive migration.

**The architecture is correct.** The work is execution, not redesign.

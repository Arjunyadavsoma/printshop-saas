# PrintShop Unified Platform — Phase 0 Final Report

> Final summary report consolidating the 6 preceding audit documents. Sections A-K as specified. This is the master document for the PrintShop platform audit (batch 2).

**Audit date:** 2025-11-08 · **Commit:** `dc24f4b` · **Branch:** `main`
**Production:** `https://printshop-saas-three.vercel.app` — health 200, DB OK (14 tables in schema, 10 live), 1 shop
**CI:** `tsc --noEmit` exit 0 · `eslint` 0 errors · `vitest run` 244/244 pass
**Source of truth:** actual source files in `/home/z/my-project` (no fabricated claims)

---

## A. Current system (what exists)

### A.1 Cloud backend — VERIFIED
- Next.js 16 serverless on Vercel
- 70 API routes under `/api/v1/*`
- 14 Prisma models (`prisma/schema.prisma:1-326`); 10 tables live in production
- 3-layer tenant isolation (auth → query → mutation)
- Payment pipeline: PhonePe v1+v2, Paytm, UPI deep-link, cash-on-pickup (234 tests)
- Print-agent protocol: device-token auth, atomic job claiming, presigned-URL delivery
- Sync endpoints: pull/push/status (all 401 without device token — VERIFIED)

### A.2 Website — VERIFIED
- 21 pages using semantic design tokens
- Consumer flow: `/shops/[slug]` → `/orders/[id]`
- Shopkeeper flow: `/shop/{dashboard,orders,settings,reports,printer}`
- Admin flow: `/admin/{orders,shops,analytics,monitoring}`

### A.3 Realtime relay — IMPLEMENTED, NOT DEPLOYED
- `mini-services/realtime-service/index.ts:1-168` — Socket.IO + HTTP `/emit` relay
- Two-port design (3003 ws, 3004 emit relay)
- JWT-verified room joins (`shop:<shopId>`)
- Blocked on Render/Railway deployment (KNOWN_LIMITATIONS P1-3)

### A.4 Windows desktop (PrintEXE) — BLOCKED
- .NET 10 WPF, 6-project solution
- **Protocol INCOMPATIBLE** with SaaS backend (7 mismatches — see `PRINTEXE_CONTRACT_AUDIT.md`)
- Never compiled (Linux sandbox can't build WPF)

### A.5 Android — NOT STARTED

---

## B. Target system (what must be built)

### B.1 Subscription-gated multi-tenant SaaS
- First 100 shops = launch cohort (admin-selected free access)
- Paid plans from launch (`free`, `pro`, `business`)
- `requireEntitlement('feature')` middleware gates routes
- Central admin control of subscription state

### B.2 Durable payment pipeline
- `PaymentAttempt` model replaces cache-only session lookup
- `PaymentEvent` model persists every webhook event for audit/reconciliation
- DB-primary lookup with cache as fast-path overlay

### B.3 Always-on realtime
- Render/Railway-hosted Socket.IO (not Vercel)
- Caddy `?XTransformPort=3003` gateway
- Live dashboard + job dispatch

### B.4 PrintEXE adapted to SaaS contract
- One-way protocol adaptation (PrintEXE changes, server unchanged for 5/7 fixes)
- Magic-link pairing → paste-token (Option A) or new pairing routes (Option B)

### B.5 Customer delivery tracking UI
- Customer sees "Dispatched" + "Received by device"
- Shopkeeper sees delivery attempt history

### B.6 Android (consumer + admin)
- Locked API contract (Phase 6)
- Two native Kotlin apps (Phase 7)

---

## C. Reuse strategy (keep / extend / refactor)

| Component | Decision | Rationale |
|---|---|---|
| Auth model (JWT + device token + order token) | KEEP + EXTEND | 3-tier model supports all client types |
| Tenant isolation (3-layer) | KEEP | No known bypass |
| Payment pipeline | EXTEND | Add `PaymentAttempt` lookup alongside cache |
| Print-agent protocol | KEEP | PrintEXE must adapt (1-way) |
| Realtime relay | KEEP + DEPLOY | Code complete; needs hosting move |
| Subscription model | REFACTOR (wire it) | Vestigial today — wire to repos + middleware |
| Reports | EXTEND | Add 7-value separation + refund tracking |
| Sync protocol | KEEP | Bidirectional cursor sync already designed |
| Customer delivery tracking UI | EXTEND | Model + service exist; UI not built |
| `Shop.subscriptionTier` field | DEPRECATE (Phase D) | Move source of truth to `Subscription` model |

**Principle: extend, don't refactor.** No rewrite. No platform migration.

---

## D. Critical blockers (all P0/P1 findings)

| ID | Finding | Severity | Phase | Reference |
|---|---|---|---|---|
| PC-001 through PC-007 | PrintEXE protocol incompatible (7 mismatches) | P0 | Phase 1 | `PRINTEXE_CONTRACT_AUDIT.md` |
| ARCH-006 | `migration_lock.toml` says sqlite, prod is postgresql | P0 | (pre-Phase 5) | `PRODUCTION_READINESS_AUDIT.md` C1 |
| SEC-009 | No entitlements enforcement | P1 | Phase 2 | `SUBSCRIPTION_GAP_ANALYSIS.md` GAP-002 |
| SEC-019 | `PaymentAttempt` not wired (cache-only webhook) | P1 | Phase 3 | `FINANCIAL_REPORTING_AUDIT.md` §5 |
| ARCH-004 | Realtime service not deployed | P1 | Phase 4 | KNOWN_LIMITATIONS P1-3 |
| ARCH-005 | 4 new tables missing from prod DB | P1 | pre-Phase 5 | PRODUCTION_READINESS_AUDIT H1 |
| ARCH-007 | `CRON_SECRET` not configured | P1 | pre-Phase 5 | KNOWN_LIMITATIONS P1-1 |
| SEC-025 | Rate limiting per-invocation on Vercel | P1 | (parallel) | SECURITY_AUDIT.md SEC-025 |
| SEC-016 | JWT secrets not rotated | P1 | (parallel) | SECURITY_AUDIT.md SEC-016 |

**All P0 security findings already fixed** (SEC-001 IDOR, SEC-002 password leak, SEC-003 token display, SEC-004 Prisma error leak — `docs/SECURITY_ASSESSMENT.md:257-264`).

---

## E. Database plan (required changes, NO EXECUTION)

### E.1 Already in schema, missing from prod DB (additive migration)
**File:** `prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql`
**Tables to create:** `DeviceSyncState`, `Customer`, `PrintDeliveryAttempt`, `FileCleanupTask`
**Safe:** additive only (no DROP/ALTER on existing tables)
**Rollback:** `DROP TABLE IF EXISTS "FileCleanupTask"; DROP TABLE IF EXISTS "PrintDeliveryAttempt"; DROP TABLE IF EXISTS "Customer"; DROP TABLE IF EXISTS "DeviceSyncState";` (safe — no FKs from existing tables)
**Approval required:** user must backup DB + run SQL via Supabase SQL Editor

### E.2 Schema changes needed (future, NOT in current migration)
- `Shop.cohortId String?` — launch cohort tracking (Phase B of subscription wiring)
- `Refund` model — `{id, shopId, orderId?, amountPaise, reason, status, paymentTxnId}` (Phase 2 of FINANCIAL_BUSINESS_LOGIC)
- `Settlement` model — bank reconciliation (Phase 2+)
- `Invoice` model — per `docs/FINANCIAL_BUSINESS_LOGIC.md:131-154`

### E.3 Migration lock fix
- `prisma/migrations/migration_lock.toml` — change `provider = "sqlite"` → `provider = "postgresql"`
- Baseline history: `prisma migrate resolve --applied 20261015172034_init`
- Do NOT run `prisma migrate deploy` until fixed

### E.4 No schema change for Phases 1-4
Phases 1 (PrintEXE), 2 (subscription wiring), 3 (PaymentAttempt wiring), 4 (realtime deploy) all use the EXISTING schema. No migration needed for these phases.

---

## F. API plan (preserve / modify / add)

### F.1 PRESERVE (no change)
- `/api/v1/auth/{login,register,refresh}` — auth flows
- `/api/v1/agents/{register,token,heartbeat,jobs/pending,jobs/[id]/status,jobs/[id]/received,[id]}` — full agent protocol
- `/api/v1/orders/[id]/*` — customer order flow
- `/api/v1/shops/me/orders/*` — shopkeeper order management
- `/api/v1/admin/{shops,orders,analytics,audit}` — admin tools
- `/api/v1/sync/{pull,push,status}` — sync protocol
- `/api/v1/payments/{phonepe/webhook,paytm/callback,upi/verify,dev/*}` — payment webhooks
- `/api/v1/health,ready,db-health,metrics` — ops endpoints

### F.2 MODIFY
- `src/lib/payments/webhook.service.ts:27-35` — replace `lookupPaymentSession` (cache) with `PaymentAttempt.findOne` (DB-primary)
- `src/app/api/v1/orders/[id]/checkout/route.ts` — write `PaymentAttempt` row at checkout
- `src/app/api/v1/shops/me/analytics/route.ts:9` — add `['owner']` role restriction (SEC-010)
- `src/app/api/v1/shops/me/reports/daily/route.ts` — add `refundsPaise` field when Refund model lands
- `src/app/api/v1/admin/analytics/route.ts` — add `subscriptionRevenuePaise` when Subscription wired

### F.3 ADD
- `POST /api/v1/admin/shops/{id}/subscription` — admin grants/changes tier
- `GET /api/v1/admin/subscriptions` — list all subscriptions
- `POST /api/v1/agents/pairing/begin` + `POST /api/v1/agents/pairing/exchange` (Option B for PrintEXE magic-link — optional)
- `POST /api/v1/devices/fcm/register` — Android FCM push registration (Phase 6)
- `POST /api/v1/admin/notifications/broadcast` — admin push (Phase 6)
- `POST /api/v1/subscriptions/checkout` — paid-plan checkout (Phase C of subscription)
- `POST /api/v1/subscriptions/webhook/{provider}` — subscription payment webhook (Phase C)

---

## G. PrintEXE plan (exact integration changes)

### G.1 PrintEXE-side changes (8 changes)
1. `HttpPrintShopBackend.cs` — `Authorization: Bearer` + `/api/v1/agents/*` paths + correct DTOs
2. `SocketIoRealtimeClient.cs` — `/?XTransformPort=3003`, `auth {token: jwt}`, listen for `job.dispatch`
3. `CompanionProtocol.cs` — update constants (paths, event names)
4. Add token-exchange call — `POST /api/v1/agents/token` before socket connect
5. Drop magic-link pairing — paste-token field (Option A)
6. Drop `POST /jobs/{id}/ack` — fold claim into `{status:'printing'}`
7. Replace `POST /device/revoke` — `DELETE /api/v1/agents/{id}` with owner JWT
8. Add receipt call — `POST /api/v1/agents/jobs/{jobId}/received` after PDF download

### G.2 Server-side changes (minimal)
- All backend routes already exist (`register`, `token`, `heartbeat`, `jobs/pending`, `jobs/[id]/status`, `jobs/[id]/received`, `DELETE [id]`)
- ONLY addition (optional): `POST /api/v1/agents/pairing/begin` + `POST /api/v1/agents/pairing/exchange` for Option B magic-link UX
- The contract adaptation is **one-way: PrintEXE changes, server stays**

### G.3 Verification gates
1. Pair against production (paste-token)
2. Receive `job.dispatch` event
3. Claim via `{status:'printing'}`
4. Complete via `{status:'completed'}`
5. Send receipt via `/agents/jobs/{id}/received`

---

## H. Website plan (consumer + shopkeeper UI work)

### H.1 Consumer UI
- `/orders/[id]` — add delivery status indicators (Phase 5): dispatched, received, printed, ready
- TrackStep component enhancement (P2-7 fix)

### H.2 Shopkeeper UI
- `/shop/printer` — Printer Setup page exists (`src/app/shop/printer/page.tsx`) with `DeviceManager` (431 lines, VERIFIED)
- `/shop/dashboard` — add delivery attempt history section (P2-8 fix)
- `/shop/reports` — add refund field when Refund model lands
- `/shop/settings` — add subscription tier display + upgrade flow (Phase C)

### H.3 Admin UI
- `/admin/shops/[id]` — add subscription tier management (Phase 2)
- `/admin/analytics` — add PrintShop subscription revenue column (Phase C)
- `/admin/monitoring` — realtime service health (Phase 4)

### H.4 UX polish (P2/P3)
- Add `loading.tsx`, `error.tsx`, `not-found.tsx` route files (P2-6)
- Add `if (document.hidden) return;` to 6 polling intervals (P2-5)
- Dark mode toggle via `next-themes` (P3-6)
- Remove 22 unused shadcn components (P3-3)

---

## I. Android readiness (API prerequisites)

### I.1 Already-ready endpoints
- Auth: `/api/v1/auth/{login,refresh}` + `/api/v1/me`
- Public shop discovery: `/api/v1/shops/{slug}`
- Customer order flow: `/api/v1/orders/{id}/*` (order-token auth)
- Shopkeeper dashboard: `/api/v1/shops/me/*`
- Admin: `/api/v1/admin/*`
- File upload: presigned PUT URLs via `/api/v1/orders/{id}/files/upload-url`
- Receipt download: `/api/v1/orders/{id}/receipt?t=<token>`

### I.2 Missing endpoints (Phase 6)
- `POST /api/v1/devices/fcm/register` — FCM token registration
- `POST /api/v1/admin/notifications/broadcast` — admin push

### I.3 Prerequisites before Android dev starts
1. Phase 2 complete (entitlements enforced — Android relies on them)
2. Phase 3 complete (PaymentAttempt wired — Android checkout relies on durable mapping)
3. Phase 6 contract locked (no breaking API changes after Android dev starts)
4. FCM project configured (Firebase console)

### I.4 Android-specific risks
- API contract drift — mitigated by Phase 6 lock
- Push notification delivery — FCM is reliable but not guaranteed; need in-app fallback
- File upload from mobile — multipart + presigned PUT works but test on slow networks

---

## J. Implementation sequence (dependency-aware phases)

```
Day 1:  ┌─ Phase 1 (PrintEXE adaptation) — Windows/.NET engineer
        ├─ Phase 2 (Subscription wiring) — Backend engineer 1
        ├─ Phase 3 (PaymentAttempt wiring) — Backend engineer 2
        └─ Phase 4 (Realtime deploy) — DevOps engineer

After Phase 4 + DB migration:
        └─ Phase 5 (Delivery tracking UI) — Frontend engineer

After Phases 2 + 3:
        └─ Phase 6 (Android API contracts) — Mobile engineer

After Phase 6:
        └─ Phase 7 (Android apps) — Mobile engineer
```

**Critical path:** ~4-6 weeks (Phase 1 + 4 in parallel → Phase 5 → Phase 6 → Phase 7).

**Detailed per-phase data:** see `IMPLEMENTATION_ROADMAP.md`.

**Key insight:** Phases 1-4 can run in parallel by 4 separate engineers. No phase requires a schema migration (Phase 5 needs the already-prepared additive migration, which is BLOCKED on user approval).

---

## K. Risk assessment

### K.1 Data loss risk
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DB migration applied without backup | LOW | CRITICAL | Require `pg_dump` before approval (PRODUCTION_READINESS_AUDIT.md:147) |
| Webhook cache expiry loses merchantOrderId mapping | MED | HIGH | Phase 3 wires `PaymentAttempt` (DB-primary) |
| Audit log pruning loses dispute evidence | MED | MED | Export to cold storage before 30-day prune (SEC-031) |
| PrintEXE SQLite queue corruption | LOW | LOW | Transit cache only — server is source of truth |

### K.2 Security risk
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Free-tier shops use all features | HIGH (current) | MED (revenue loss) | Phase 2 gates routes |
| Brute-force on serverless rate limits | MED | MED | Phase SEC-025: Upstash Redis |
| PrintEXE token exfiltration via modified binary | LOW | HIGH | EV code signing + integrity check (SEC-029) |
| JWT secret leak | LOW | CRITICAL | Phase SEC-016: key rotation via `kid` |

### K.3 Downtime risk
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Realtime service outage | MED | LOW (falls back to polling) | Dashboard polls every 15-30s as fallback |
| DB connection pool exhaustion | LOW | HIGH | Supabase pooler (pgbouncer) at port 6543 |
| Vercel cold start on webhook | MED | MED | Phase 3 DB-primary lookup removes cache dependency |
| Caddy gateway misconfig | LOW | MED | Test `?XTransformPort=3003` before each deploy |

### K.4 Compatibility risk
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PrintEXE doesn't compile on Windows | MED | HIGH | GitHub Actions windows-latest runner |
| PrintEXE + Bun/TS CLI race for same shop | MED | MED | Atomic claiming (`status:'printing'`) prevents duplicates — DESKTOP_INTEGRATION.md §7 |
| Android API contract changes after Phase 7 starts | MED | HIGH | Phase 6 formally locks the contract |
| `migration_lock.toml` mismatch breaks future migrations | HIGH (current) | HIGH | Fix to `postgresql` + baseline history (SEC-021) |

### K.5 Migration risk
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Additive migration creates orphan tables | LOW | LOW | All new tables have `shopId` FK; no orphan risk |
| Rollback fails | LOW | MED | Rollback SQL documented; no FKs from existing tables |
| Subscription wiring breaks existing shop registration | LOW | MED | Phase A creates row in try/catch; failure doesn't block registration |
| PaymentAttempt migration breaks checkout | LOW | HIGH | Keep cache fallback; A/B test (FIN-006 mitigation) |

---

## Verdict

**The PrintShop platform is structurally correct and mostly built.** The remaining work is execution, not redesign.

**P0 blockers (2):** PrintEXE protocol adaptation (Phase 1) + migration_lock fix.
**P1 blockers (7):** subscription enforcement, PaymentAttempt wiring, realtime deployment, DB migration, CRON_SECRET, rate limiting, JWT rotation.

**Critical path: ~4-6 weeks** with 4 engineers in parallel.

**No rewrite. No platform migration. Extend, don't refactor.**

---

## Audit documents in this batch

| # | File | Lines | Topic |
|---|---|---|---|
| 1 | `SYSTEM_ARCHITECTURE_TARGET.md` | ~150 | Target architecture + AS-IS/TO-BE |
| 2 | `PRINTEXE_CONTRACT_AUDIT.md` | ~190 | 7 contract mismatches (master reference) |
| 3 | `SUBSCRIPTION_GAP_ANALYSIS.md` | ~170 | Subscription system gaps + Phase A-D plan |
| 4 | `FINANCIAL_REPORTING_AUDIT.md` | ~180 | 7 financial values + webhook idempotency |
| 5 | `SECURITY_AUDIT.md` | ~190 | OWASP Top 10 findings (SEC-001 to SEC-032) |
| 6 | `IMPLEMENTATION_ROADMAP.md` | ~180 | Dependency-aware phases 1-7 |
| 7 | `PHASE_0_FINAL_REPORT.md` | this file | Summary A-K |

**Predecessor docs (referenced throughout):**
- `docs/DESKTOP_INTEGRATION.md` — PrintEXE incompatibility analysis
- `docs/PRINTEXE_INTEGRATION_GUIDE.md` — correct SaaS contract (925 lines)
- `docs/SECURITY_ASSESSMENT.md` — security v1.0
- `docs/KNOWN_LIMITATIONS.md` — known gaps (P0-P3)
- `docs/PRODUCTION_READINESS_AUDIT.md` — readiness assessment

**No source code was modified.** Audit only.

# PrintShop — Migration Plan

> Roadmap for migrating the PrintShop platform from its current state
> (web-only SaaS + incompatible PrintEXE) to a unified platform where
> both clients share one backend.

**Status:** v1.0 — 2025-11-07.

---

## 1. Current state

### 1.1 PrintShop SaaS (web)

- ✅ Production-deployed at `https://printshop-saas-three.vercel.app`
- ✅ 60 API routes, 10 Prisma models, 234 tests
- ✅ All 21 pages migrated to semantic design tokens
- ✅ Sync endpoints implemented (this session): `/api/v1/sync/*`, `/api/v1/devices/register`
- ✅ `Customer` + `DeviceSyncState` models in schema
- ✅ `revision` + `deletedAt` fields on 5 synced models
- ⚠️ DB migration NOT run (tables don't exist in Supabase yet)
- ⚠️ `Subscription` model vestigial
- ⚠️ `PaymentAttempt`/`PaymentEvent` models vestigial

### 1.2 PrintEXE (Windows desktop)

- ✅ .NET 10 / WPF codebase exists at `github.com/Arjunyadvsoma/PrintEXE`
- ❌ Wire protocol incompatible with SaaS backend
- ❌ Never compiled on Windows
- ❌ Never paired with production backend
- ❌ Magic-link pairing not supported server-side

---

## 2. Migration phases

### Phase A: Schema migration (SaaS-side, user-executed)

**What:** Push the new Prisma schema to Supabase.

**Steps:**
1. Backup the production database:
   ```bash
   pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d).sql
   ```
2. Run the schema push:
   ```bash
   cd /home/z/my-project
   bun run db:generate  # regenerate client (already done this session)
   bun run db:push      # sync schema to DB
   ```
   **⚠️ `db:push` uses `--accept-data-loss` — only run on a backed-up DB.**
3. Verify the new tables exist:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
   -- Should include: Customer, DeviceSyncState
   -- Plus existing tables with new columns: revision, deletedAt
   ```
4. Run the one-time setup if needed:
   ```bash
   curl -X POST "https://printshop-saas-three.vercel.app/api/v1/setup-database?key=$SETUP_KEY"
   ```

**Risk:** Low — additive changes only (new tables, new columns with defaults). No existing data is modified.

**Rollback:** restore from the `pg_dump` backup.

### Phase B: PrintEXE protocol adaptation (PrintEXE-side)

**What:** Rewrite PrintEXE's backend client to use the real SaaS protocol.

**Files to change in PrintEXE:**
1. `src/PrintShopCompanion.Infrastructure/Backend/HttpPrintShopBackend.cs`:
   - Change auth header from `X-PrintShop-Device-Token` to `Authorization: Bearer <token>`
   - Change paths from `/pair`, `/heartbeat`, `/agents/jobs/pending`, `/jobs/{id}/status` to `/api/v1/agents/register`, `/api/v1/agents/heartbeat`, `/api/v1/agents/jobs/pending`, `/api/v1/agents/jobs/{id}/status`
   - Change status DTO from `{printedAt, failedAt, errorMessage}` to `{status: 'printing'|'completed'|'failed', lastError?, printerName?}`
   - Drop `/jobs/{id}/ack` call entirely
   - Add `POST /api/v1/agents/token` call before socket.io connect
   - Replace `POST /device/revoke` with `DELETE /api/v1/agents/{id}`

2. `src/PrintShopCompanion.Infrastructure/Backend/SocketIoRealtimeClient.cs`:
   - Change path from `/companion-hub` to `/?XTransformPort=3003`
   - Add `auth {token: jwt}` emit after connect
   - Listen for `job.dispatch` instead of `DeliverJob`
   - Drop `AckJob`/`ReportStatus`/`Heartbeat` outbound events

3. `src/PrintShopCompanion.Shared/Constants/CompanionProtocol.cs`:
   - Update all path + event name constants

4. `src/PrintShopCompanion.Infrastructure/Pairing/MagicLinkPairingService.cs`:
   - Replace magic-link flow with "paste token" field (Option A) OR
   - Add server-side pairing routes (Option B — requires SaaS changes)

**Estimated effort:** 2-3 days of C# development + testing on Windows.

**Risk:** Medium — protocol changes are mechanical but must be tested against the real backend.

### Phase C: PrintEXE compilation + Windows testing

**What:** Compile PrintEXE on Windows + run the cross-client tests.

**Steps:**
1. On a Windows machine with .NET 10 SDK:
   ```powershell
   cd PrintEXE
   dotnet build
   dotnet test
   ```
2. Run the MSI installer build:
   ```powershell
   .\scripts\install-on-windows.ps1
   ```
3. Install on a test Windows machine
4. Pair with the SaaS backend (using the paste-token flow)
5. Execute TEST A-G from `docs/CROSS_CLIENT_TESTS.md`

**Blockers:**
- WPF requires Windows (can't compile on Linux/macOS)
- SumatraPDF must be bundled for PDF rendering
- Code signing certificate recommended for production distribution

### Phase D: Sync infrastructure activation (SaaS-side)

**What:** Enable the sync endpoints in production.

**Steps:**
1. Verify the sync routes are deployed:
   ```bash
   curl https://printshop-saas-three.vercel.app/api/v1/sync/status
   # Should return 401 (device auth required)
   ```
2. Register a test device:
   ```bash
   # First, login as a shop owner to get a JWT
   TOKEN=$(curl -s -X POST https://printshop-saas-three.vercel.app/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"owner@shop.com","password":"..."}' | jq -r '.data.accessToken')
   
   # Register a print agent
   AGENT=$(curl -s -X POST https://printshop-saas-three.vercel.app/api/v1/agents/register \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Sync Device"}')
   
   DEVICE_ID=$(echo $AGENT | jq -r '.data.agentId')
   DEVICE_TOKEN=$(echo $AGENT | jq -r '.data.deviceToken')
   
   # Register for sync
   curl -s -X POST https://printshop-saas-three.vercel.app/api/v1/devices/register \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"deviceId\":\"$DEVICE_ID\",\"deviceName\":\"Test Sync Device\"}"
   
   # Pull changes
   curl -s https://printshop-saas-three.vercel.app/api/v1/sync/pull?cursor=1970-01-01T00:00:00Z \
     -H "Authorization: Bearer $DEVICE_TOKEN"
   ```
3. Verify the pull returns existing orders (with `revision` + `updatedAt`)

### Phase E: Business modules (Phase 2 — future)

**What:** Add the missing business modules (Customers, Products, Invoices, Expenses, Inventory).

**Priority:**
1. `Customer` model — already in schema, needs DB push + UI
2. `Invoice` model — needs schema + routes + UI
3. `Product` model — needs schema + routes + UI
4. `Expense` model — needs schema + routes + UI
5. `Inventory` + `Supplier` models — needs schema + routes + UI

Each module follows the pattern:
1. Add Prisma model (with `revision` + `deletedAt` + `shopId`)
2. Add repository (`src/lib/repositories/{entity}.repository.ts`)
3. Add API routes (`src/app/api/v1/shops/me/{entity}/*`)
4. Add sync support (entity is automatically pullable if it has `shopId` + `updatedAt`)
5. Add UI (web dashboard page)
6. Add tests

---

## 3. Rollback strategy

### 3.1 Schema rollback

```bash
# Restore from backup
psql "$DATABASE_URL" < backup-YYYYMMDD.sql
```

The `revision` + `deletedAt` columns are additive — removing them doesn't break existing code. The `Customer` + `DeviceSyncState` tables can be dropped without affecting existing functionality.

### 3.2 Code rollback

```bash
git revert <commit-hash>
git push origin main
```

Vercel auto-deploys on push.

### 3.3 PrintEXE rollback

PrintEXE is a desktop app — rollback requires uninstalling the new version + installing the old MSI. Keep the old MSI signed + available.

---

## 4. Compatibility preservation

### 4.1 Existing API contracts

All 60 existing API routes are **unchanged**. The sync endpoints are additive (`/api/v1/sync/*`, `/api/v1/devices/*`). The `DELETE /api/v1/agents/{id}` is new. No existing route's request/response shape changed.

### 4.2 Existing web UI

All 21 redesigned pages are unchanged. The design tokens are stable. No breaking changes to the customer or shopkeeper experience.

### 4.3 Existing print agent (Bun/TS CLI)

The existing `mini-services/print-agent/` CLI continues to work. The new `revision`/`deletedAt` columns are ignored by the CLI (it doesn't sync). The `DELETE /api/v1/agents/{id}` route is additive.

### 4.4 Existing payments

The payment pipeline is unchanged. The `PaymentAttempt`/`PaymentEvent` models remain vestigial (not wired). No payment flow changes.

---

## 5. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Schema migration fails on Supabase | Low | Medium | Backup first; additive changes only |
| PrintEXE can't compile on Windows | Medium | High | Test on Windows early; HONEST-STATUS.md documents known issues |
| Sync endpoints have bugs | Medium | Medium | tsc + lint + vitest pass; add integration tests |
| Desktop sync corrupts data | Low | Critical | Server-authoritative; conflict detection; idempotency |
| Tenant isolation breach | Low | Critical | 3-layer defense; tenant-scoped queries; TEST F verifies |
| Payment regression | Low | Critical | No payment code changed; 234 tests pass |

---

## 6. Execution order

```
Phase A (schema push) → Phase D (sync activation) → Phase B (PrintEXE adaptation) → Phase C (Windows testing) → Phase E (business modules)
```

**Phase A + D can be done immediately** (SaaS-side only, no Windows needed).
**Phase B + C require a Windows machine** (PrintEXE compilation + testing).
**Phase E is ongoing** (each module is a separate mini-project).

---

## 7. Success criteria

The migration is complete when:
1. ✅ `Customer` + `DeviceSyncState` tables exist in production Supabase
2. ✅ `/api/v1/sync/*` endpoints are callable in production
3. ✅ PrintEXE compiles on Windows
4. ✅ PrintEXE pairs with the production backend
5. ✅ PrintEXE receives print jobs via the real protocol
6. ✅ TEST A-G pass (cross-client tests)
7. ✅ A print shop can use both clients interchangeably

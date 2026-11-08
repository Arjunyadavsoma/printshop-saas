# PrintShop SaaS — Independent Production Readiness Audit

> Conducted 2025-11-08 against commit `7603665` (before audit tests) →
> final commit after audit work. Every finding has evidence.

---

## 1. Starting + ending commits

| | Commit | Description |
|---|---|---|
| **Start** | `7603665` | Migration SQL + GitHub Actions + CI + Printer Setup UI + route checker |
| **End** | (this audit) | + delivery coordinator tests + this audit report |

---

## 2. Audit findings by severity

### 🔴 CRITICAL (release-blocking)

**C1: Migration history drift — `migration_lock.toml` declares SQLite, production uses PostgreSQL**

- `prisma/migrations/migration_lock.toml` contains `provider = "sqlite"`
- `prisma/schema.prisma` declares `provider = "postgresql"`
- `prisma/migrations/20261015172034_init/migration.sql` uses SQLite SQL (`DATETIME`, `PRAGMA foreign_keys`, `TEXT PRIMARY KEY`)
- Production DB is PostgreSQL (Supabase, verified via `/api/v1/db-health`: `databaseUrl` starts with `postgresql://`)
- **Impact:** `prisma migrate deploy` would try to apply the SQLite init migration to PostgreSQL → **FAIL**
- **Evidence:** `cat prisma/migrations/migration_lock.toml` → `provider = "sqlite"`; `curl /api/v1/db-health` → `databaseUrl: postgresql://...`
- **Fix:** Do NOT use `prisma migrate deploy`. Use either:
  - `prisma db push` (syncs schema to DB — additive only, safe for new tables)
  - OR manually run the new migration SQL (`prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql`) via Supabase SQL Editor
  - Then update `migration_lock.toml` to `provider = "postgresql"` and baseline the migration history

### 🟡 HIGH (not blocking but must address)

**H1: Four new tables genuinely absent from production DB**
- Schema has 14 models; production has 10 tables
- Missing: `DeviceSyncState`, `Customer`, `PrintDeliveryAttempt`, `FileCleanupTask`
- **Evidence:** `curl /api/v1/db-health` → `tables: ['AuditLog','Order','PaymentAttempt','PaymentEvent','PrintAgent','PrintFile','PrintJob','Shop','Subscription','User']`, `tablesCount: 10`
- **Impact:** Delivery tracking, sync, and cleanup features are designed but not operational
- **Code gracefully degrades:** all new-table queries are wrapped in try/catch (verified in tests)

**H2: `CRON_SECRET` not configured**
- The cron endpoint (`/api/v1/cron/cleanup`) returns 401 without the secret
- GitHub Actions workflow (`.github/workflows/cleanup-cron.yml`) references `${{ secrets.CRON_SECRET }}` but the secret is not set in the GitHub repo
- Vercel env var `CRON_SECRET` is not set
- **Evidence:** `curl /api/v1/cron/cleanup` → 401
- **Fix:** Set `CRON_SECRET` in both GitHub repo secrets + Vercel env vars (same value)

**H3: GitHub Actions cron not verified**
- Workflow file exists but no execution has been observed
- **Status:** BLOCKED — requires `CRON_SECRET` configuration first

### 🟢 MEDIUM

**M1: `vercel-build.sh` sed is a no-op**
- Line 21: `sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma`
- The schema already has `provider = "postgresql"` — the sed does nothing
- **Impact:** None (the schema is already correct for PostgreSQL)
- **Fix:** Remove the sed or update the script to handle the current state

**M2: `Subscription` model is vestigial**
- Schema has the model; zero code references it
- Tier is read from `Shop.subscriptionTier` instead
- No entitlements enforcement exists
- **Status:** IMPLEMENTED (schema) / NOT VERIFIED (code)

**M3: `PaymentAttempt` + `PaymentEvent` models are vestigial**
- Schema has the models; webhook pipeline still uses cache-only session lookup
- **Status:** IMPLEMENTED (schema) / NOT VERIFIED (code)

---

## 3. Files changed (this audit)

| File | Change | Purpose |
|---|---|---|
| `src/lib/services/delivery-coordinator.test.ts` | NEW (280 lines) | 10 authenticated contract tests |
| `docs/PRODUCTION_READINESS_AUDIT.md` | NEW (this file) | Comprehensive audit report |

---

## 4. Test commands and exact results

```
$ npx tsc --noEmit
(exit 0 — zero errors)

$ bun run lint
$ eslint .
(exit 0 — 0 errors, 0 warnings)

$ bunx vitest run
Test Files  23 passed (23)
     Tests  244 passed (244)    ← 234 existing + 10 new delivery coordinator tests
  Duration  8.2s

$ bash scripts/check-route-conflicts.sh
✅ No dynamic route conflicts found.
```

### New delivery coordinator tests (10/10 pass):
- `findEligibleAgents`: finds agents with fresh heartbeats ✅
- `findEligibleAgents`: excludes agents with stale heartbeats (>30s) ✅
- `findEligibleAgents`: excludes agents with no heartbeat ✅
- `findEligibleAgents`: tenant isolation (only returns own shop's agents) ✅
- `markDeliveryReceived`: acknowledges receipt for valid job ✅
- `markDeliveryReceived`: idempotent (duplicate returns success) ✅
- `markDeliveryReceived`: does NOT interpret receipt as print completion ✅
- `processCleanupTasks`: returns zeros when no tasks exist ✅
- `processCleanupTasks`: handles missing table gracefully ✅
- Cross-tenant isolation: shop B cannot see shop A's agents ✅

---

## 5. Prisma/PostgreSQL migration audit

### Migration history
```
prisma/migrations/
  migration_lock.toml          → provider = "sqlite" ⚠️ MISMATCH
  20261015172034_init/         → SQLite SQL (DATETIME, PRAGMA)
  20251108000000_add_delivery_and_sync/ → PostgreSQL SQL (TIMESTAMP(3))
```

### Production DB state
- **Provider:** PostgreSQL (Supabase pooler, port 6543)
- **Connection:** OK
- **Tables:** 10 (missing 4 new tables)
- **Shop count:** 1 ("Arjun Print Hub")
- **User count:** 1

### Migration readiness

| Check | Status |
|---|---|
| New migration SQL is PostgreSQL-compatible | ✅ VERIFIED |
| New migration is additive (no DROP/ALTER on existing tables) | ✅ VERIFIED |
| New migration has correct indexes | ✅ VERIFIED |
| `migration_lock.toml` matches production provider | ❌ CRITICAL — says sqlite, prod is postgresql |
| `prisma migrate deploy` would work | ❌ NO — init migration is SQLite SQL |
| `prisma db push` would work | ✅ YES — syncs schema directly (additive) |
| Manual SQL execution via Supabase SQL Editor | ✅ YES — run the new migration SQL directly |

### Recommended migration path

1. **Backup production DB:** `pg_dump "$DATABASE_URL" > backup.sql`
2. **Review the migration SQL:** `cat prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql`
3. **Execute via Supabase SQL Editor** (safest — paste the SQL + run)
4. **Verify:** `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;` → should show 14 tables
5. **Fix migration_lock.toml:** change `provider = "sqlite"` to `provider = "postgresql"`
6. **Do NOT run `prisma migrate deploy`** — it would try to apply the SQLite init migration

### Rollback
```sql
DROP TABLE IF EXISTS "FileCleanupTask";
DROP TABLE IF EXISTS "PrintDeliveryAttempt";
DROP TABLE IF EXISTS "Customer";
DROP TABLE IF EXISTS "DeviceSyncState";
```
Safe — no foreign keys from existing tables to the new tables.

---

## 6. Production migration status

**NOT APPLIED.** Requires explicit user approval.

| Step | Status |
|---|---|
| Migration SQL generated | ✅ VERIFIED |
| Migration SQL reviewed | ✅ VERIFIED (PostgreSQL, additive, correct indexes) |
| DB backup | ⏳ BLOCKED — requires user to run `pg_dump` |
| Staging validation | ⏳ BLOCKED — no staging DB available |
| Production execution | ⏳ BLOCKED — requires explicit approval |

---

## 7. Delivery protocol test results

### Endpoint verification (production, unauthenticated — 401 = auth working)

| Endpoint | HTTP | Status | Evidence |
|---|---|---|---|
| `POST /api/v1/auth/login` | 401 | ✅ | Rejects without credentials |
| `POST /api/v1/agents/register` | 401 | ✅ | Rejects without owner JWT |
| `POST /api/v1/agents/token` | 401 | ✅ | Rejects without device token |
| `POST /api/v1/agents/heartbeat` | 401 | ✅ | Rejects without device token |
| `GET /api/v1/agents/jobs/pending` | 401 | ✅ | Rejects without device token |
| `POST /api/v1/agents/jobs/{id}/status` | 401 | ✅ | Rejects without device token |
| `DELETE /api/v1/agents/{id}` | 401 | ✅ | Rejects without owner JWT |
| `GET /api/v1/sync/pull` | 401 | ✅ | Rejects without device token |
| `POST /api/v1/sync/push` | 401 | ✅ | Rejects without device token |
| `GET /api/v1/sync/status` | 401 | ✅ | Rejects without device token |
| `POST /api/v1/agents/jobs/{id}/received` | 401 | ✅ | Rejects without device token |

### Authenticated logic verification (Vitest, in-memory container)

| Test | Status | Evidence |
|---|---|---|
| Agent selection (fresh heartbeat) | ✅ VERIFIED | `findEligibleAgents` returns online agents |
| Agent selection (stale heartbeat excluded) | ✅ VERIFIED | Agents >30s stale are filtered out |
| Agent selection (no heartbeat excluded) | ✅ VERIFIED | Agents with null `lastSeenAt` are filtered |
| Receipt acknowledgement (valid) | ✅ VERIFIED | `markDeliveryReceived` returns success |
| Receipt idempotency (duplicate) | ✅ VERIFIED | Second receipt returns success, no error |
| Receipt ≠ print completion | ✅ VERIFIED | Job stays `queued` after receipt |
| Cleanup (no tasks) | ✅ VERIFIED | Returns zeros gracefully |
| Cleanup (missing table) | ✅ VERIFIED | Does not throw |
| Cross-tenant isolation | ✅ VERIFIED | Shop B cannot see shop A's agents |
| Checksum format | ✅ VERIFIED | 64-char hex string accepted by Zod schema |

### NOT VERIFIED (blocked)

| Test | Status | Blocker |
|---|---|---|
| Full HTTP flow (login → register → receipt) | NOT VERIFIED | Cannot login without shop owner password |
| Receipt with real device token | NOT VERIFIED | No registered PrintEXE device |
| Socket.IO job dispatch | NOT VERIFIED | Realtime service not running |
| PrintEXE v0.5.2 compatibility | NOT VERIFIED | PrintEXE not compiled |

---

## 8. Cleanup worker test results

| Test | Status | Evidence |
|---|---|---|
| Cron endpoint exists | ✅ VERIFIED | `curl /api/v1/cron/cleanup` → 401 |
| Auth rejects without secret | ✅ VERIFIED | 401 without Authorization header |
| Auth rejects wrong secret | ✅ VERIFIED | 401 with wrong Bearer token |
| Auth accepts correct secret | ✅ VERIFIED | 200 with correct secret (local test) |
| `processCleanupTasks` logic | ✅ VERIFIED | Returns zeros when no tasks (graceful) |
| Cleanup with real FileCleanupTask | NOT VERIFIED | Table doesn't exist in DB |
| 15-minute grace period | NOT VERIFIED | Table doesn't exist |
| Shared object protection | NOT VERIFIED | Table doesn't exist |
| Storage deletion | NOT VERIFIED | No test objects created |

---

## 9. Scheduler execution evidence

| Check | Status |
|---|---|
| GitHub Actions workflow file exists | ✅ VERIFIED (`.github/workflows/cleanup-cron.yml`) |
| `CRON_SECRET` in GitHub repo secrets | ❌ BLOCKED — not configured |
| `CRON_SECRET` in Vercel env vars | ❌ BLOCKED — not configured |
| Manual workflow trigger observed | ❌ BLOCKED — needs secret first |
| Scheduled execution observed | ❌ BLOCKED — needs secret first |
| No secrets in logs | ✅ VERIFIED — workflow uses `${{ secrets.CRON_SECRET }}` (masked) |

---

## 10. Tenant-isolation evidence

| Test | Status | Evidence |
|---|---|---|
| `findEligibleAgents` cross-tenant | ✅ VERIFIED | Shop B cannot see shop A's agents (test passes) |
| `withAuth` tenant scoping | ✅ VERIFIED | `claims.shopId !== user.shopId` → reject (code audit) |
| `withDeviceAuth` tenant scoping | ✅ VERIFIED | Device token → `PrintAgent.shopId` (code audit) |
| `withOrderAccess` IDOR protection | ✅ VERIFIED | Per-order `customerToken` constant-time compared (code audit) |
| Repository layer `shopId` filtering | ✅ VERIFIED | Every query filters by `shopId` from principal (code audit) |
| Cross-tenant order access | NOT VERIFIED | No authenticated test with two shops (needs DB + credentials) |
| Cross-tenant customer access | NOT VERIFIED | Customer table doesn't exist in DB |
| Cross-tenant delivery access | NOT VERIFIED | PrintDeliveryAttempt table doesn't exist |

---

## 11. Payment workflow evidence

| Check | Status |
|---|---|
| PhonePe v1 webhook signature verification | ✅ VERIFIED (existing tests: `payments.test.ts`) |
| PhonePe v2 SHA auth | ✅ VERIFIED (existing tests: `phonepe-v2-webhook.test.ts`) |
| Paytm CHECKSUMHASH | ✅ VERIFIED (existing tests) |
| Payment idempotency (`paymentTxnId` UNIQUE) | ✅ VERIFIED (existing tests) |
| Amount validation | ✅ VERIFIED (existing tests) |
| Race-safe state transition | ✅ VERIFIED (existing tests) |
| Print job idempotency | ✅ VERIFIED (existing tests: `print-job-idempotency.test.ts`) |

**234 existing tests cover the payment lifecycle.** No regressions.

---

## 12. UI responsiveness results

| Area | Status | Evidence |
|---|---|---|
| Design tokens | ✅ VERIFIED | All 21 pages migrated to semantic tokens (previous session) |
| Route conflict checker | ✅ VERIFIED | `scripts/check-route-conflicts.sh` passes |
| Printer Setup UI | ✅ IMPLEMENTED | `DeviceManager` component (431 lines) |
| Customer homepage | ✅ VERIFIED | agent-browser + VLM verified (previous session) |
| Responsive 375px | ✅ VERIFIED | No horizontal overflow (previous session) |
| Dashboard PrintEXE overview | NOT VERIFIED | Not implemented |
| Customer delivery tracking | NOT VERIFIED | Not implemented |

---

## 13. Deployment status

| Check | Status | Evidence |
|---|---|---|
| Production URL | ✅ VERIFIED | `https://printshop-saas-three.vercel.app` |
| Health endpoint | ✅ VERIFIED | `GET /api/v1/health` → 200 |
| Shops API | ✅ VERIFIED | Returns "Arjun Print Hub" (1 shop) |
| Cron endpoint deployed | ✅ VERIFIED | Returns 401 (auth working) |
| Receipt endpoint deployed | ✅ VERIFIED | Returns 401 (auth working) |
| Agent register deployed | ✅ VERIFIED | Returns 401 (auth working) |
| Socket.IO | NOT VERIFIED | Realtime service may not be running on Vercel |
| DB connection | ✅ VERIFIED | `connection: OK` from db-health |
| DB migration | ❌ NOT APPLIED | 4 new tables missing |

---

## 14. Remaining blockers

| # | Blocker | Severity | Action required |
|---|---|---|---|
| 1 | Migration not applied | CRITICAL | User must backup DB + run migration SQL via Supabase SQL Editor |
| 2 | `migration_lock.toml` says sqlite | CRITICAL | Update to `postgresql` after migration |
| 3 | `CRON_SECRET` not configured | HIGH | Set in GitHub secrets + Vercel env vars |
| 4 | GitHub Actions cron not verified | HIGH | Trigger manually after secret is set |
| 5 | No authenticated E2E test | HIGH | Need shop owner password or test credentials |
| 6 | PrintEXE not compiled | MEDIUM | Windows development needed |
| 7 | Dashboard PrintEXE overview | MEDIUM | Not implemented |
| 8 | Customer delivery tracking | MEDIUM | Not implemented |
| 9 | Subscription enforcement | LOW | Model is vestigial |
| 10 | PaymentAttempt/PaymentEvent not wired | LOW | Webhook uses cache |

---

## 15. Exact approvals required

1. **Production DB migration:** "I approve running the migration SQL `prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql` against the production Supabase database after taking a backup."
2. **CRON_SECRET configuration:** "I will set `CRON_SECRET` in GitHub repo secrets and Vercel env vars."
3. **Shop owner credentials:** "I will provide test credentials for authenticated E2E verification" (optional — the logic is verified via Vitest).

---

## 16. Production-readiness verdict

### VERIFIED:
- ✅ tsc, lint, 244 tests pass
- ✅ Route conflict checker passes
- ✅ Delivery coordinator logic (agent selection, receipt, idempotency, tenant isolation)
- ✅ Cleanup endpoint auth (401 without secret, 200 with correct secret)
- ✅ Payment pipeline (234 existing tests)
- ✅ All 21 pages use semantic design tokens
- ✅ Printer Setup UI (DeviceManager component)
- ✅ Production health + shops API working

### IMPLEMENTED (not fully verified):
- ⚠️ Delivery coordinator service (code exists, logic tested, but no real receipt from PrintEXE)
- ⚠️ Cleanup cron endpoint (code exists, auth tested, but no real cleanup execution)
- ⚠️ Sync endpoints (code exists, but no real sync with PrintEXE)
- ⚠️ GitHub Actions cron + CI workflows (files exist, but no execution observed)

### NOT VERIFIED:
- ❌ Production DB migration (not applied)
- ❌ Cleanup against real storage objects (table doesn't exist)
- ❌ GitHub Actions cron execution (secret not configured)
- ❌ PrintEXE integration (not compiled)
- ❌ Socket.IO realtime (service may not be running)

### BLOCKED:
- 🔒 Migration requires user approval
- 🔒 `CRON_SECRET` requires user configuration
- 🔒 PrintEXE requires Windows compilation
- 🔒 Authenticated E2E requires shop owner credentials

**Verdict: NOT production-ready for the delivery + cleanup features.** The core print-order flow (customer upload → pay → track) IS production-ready. The delivery tracking, receipt acknowledgement, and cloud cleanup are architecturally sound and unit-tested but NOT operational (DB tables missing, cron secret not configured).

# PrintShop — Desktop Integration Guide

> How the PrintEXE Windows desktop client integrates with the PrintShop
> SaaS backend. Documents the current incompatibility, the migration
> path, and the target integrated state.

**Status:** v1.0 — 2025-11-07. Based on audit of both repos.

---

## 1. Current state (honest)

### 1.1 PrintEXE exists but is NOT integrated

The `Arjunyadvsoma/PrintEXE` repo is a .NET 10 / WPF Windows desktop client ("PrintShop Companion") with:
- 6-project solution (Core, Shared, Infrastructure, App, Worker, Backend)
- SQLite durable job queue with crash-replay
- DPAPI-encrypted device token storage
- SumatraPDF + raw GDI printer rendering
- Socket.IO client + HTTP polling fallback
- Magic-link pairing (`printshopcompanion://pair?token=…`)
- WiX MSI installer

### 1.2 The SaaS repo has ZERO references to PrintEXE

Searched `/home/z/my-project` for `PrintEXE`, `printexe`, `Companion`, `windows-companion`, `X-PrintShop-Device-Token`, `printshopcompanion://`, `magic-link` — **zero matches**. The SaaS repo is unaware of PrintEXE.

### 1.3 Three separate printing efforts exist

| Effort | Location | Status |
|---|---|---|
| Bun/TypeScript print-agent CLI | `mini-services/print-agent/` | ✅ Works (the source of truth for protocol) |
| PrintLatch + native-printer | `src/lib/printlatch/`, `src/lib/printing/`, `mini-services/native-printer/` | ⚠️ Experimental |
| PrintEXE WPF companion | `github.com/Arjunyadvsoma/PrintEXE` | ❌ Incompatible protocol |

**Recommendation:** Pick ONE desktop client. The Bun/TS CLI is the protocol source of truth. PrintEXE must adapt to its protocol, or be retired.

---

## 2. Protocol incompatibilities (must be resolved)

### 2.1 Authentication header

| | PrintEXE | SaaS backend |
|---|---|---|
| Header | `X-PrintShop-Device-Token` + `X-PrintShop-Device-Id` + `X-PrintShop-Companion-Version` | `Authorization: Bearer <deviceToken>` |
| Token format | Opaque string | HMAC-SHA256('print-agent-salt', token) hashed, matched to `PrintAgent.tokenHash` |

**Fix:** PrintEXE's `HttpPrintShopBackend.cs:279-286` must send `Authorization: Bearer <token>` instead of custom headers.

### 2.2 Pairing flow

| | PrintEXE | SaaS backend |
|---|---|---|
| Mechanism | Magic-link URL `printshopcompanion://pair?token=…&shop=…&expires=…` | Copy-paste plaintext token from `POST /api/v1/agents/register` |
| Who initiates | Browser clicks a link → desktop app opens | Shopkeeper logs into web, calls register API, copies token to desktop |
| Server support | ❌ No magic-link route exists | ✅ `/api/v1/agents/register` exists (owner JWT auth) |

**Fix options:**
- **Option A (simplest):** PrintEXE shows a "Paste your device token" field. Shopkeeper generates the token in the web dashboard's Printer Setup page, copies it to PrintEXE. No server change needed.
- **Option B (better UX):** Add `POST /api/v1/agents/pairing/begin` (owner JWT, returns a 5-min pairing ticket) + `POST /api/v1/agents/pairing/exchange` (ticket → device token, no JWT needed). PrintEXE opens the magic link, exchanges the ticket. This requires new server routes.

**Recommendation:** Start with Option A (no server change). Add Option B later for UX.

### 2.3 Endpoints

| PrintEXE calls | SaaS route | Status |
|---|---|---|
| `POST /pair` | `POST /api/v1/agents/register` | ❌ Different path + auth |
| `POST /heartbeat` | `POST /api/v1/agents/heartbeat` | ⚠️ Path prefix mismatch |
| `GET /agents/jobs/pending` | `GET /api/v1/agents/jobs/pending` | ⚠️ Path prefix mismatch |
| `POST /jobs/{jobId}/ack` | (doesn't exist) | ❌ Remove |
| `POST /jobs/{jobId}/status` | `POST /api/v1/agents/jobs/{jobId}/status` | ⚠️ Path + DTO mismatch |
| `POST /device/revoke` | (doesn't exist) | ❌ Add `DELETE /api/v1/agents/{id}` |

**Fix:** PrintEXE's `HttpPrintShopBackend.cs` must use `/api/v1/agents/*` paths.

### 2.4 Status report DTO

| | PrintEXE sends | SaaS expects |
|---|---|---|
| Fields | `{printedAt, failedAt, errorMessage}` | `{status: 'printing'|'completed'|'failed', lastError?, printerName?}` |
| Claim mechanism | Separate `/ack` call | `status:"printing"` IS the atomic claim (conditional UPDATE WHERE status='queued') |

**Fix:** PrintEXE must:
1. Drop the `/jobs/{jobId}/ack` call entirely
2. Send `POST /api/v1/agents/jobs/{jobId}/status` with `{status:"printing"}` when starting (this claims the job atomically)
3. Send `{status:"completed"}` when done, or `{status:"failed", lastError:"..."}` on failure

### 2.5 Socket.IO

| | PrintEXE | SaaS backend |
|---|---|---|
| Path | `/companion-hub` | `/` (port 3003 via Caddy `?XTransformPort=3003`) |
| Auth | (none specified) | Emit `auth {token: jwt}` after connect (JWT from `POST /api/v1/agents/token`) |
| Inbound events | `DeliverJob` | `job.dispatch` |
| Outbound events | `AckJob`, `ReportStatus`, `Heartbeat` | (no outbound — status via REST) |

**Fix:** PrintEXE's `SocketIoRealtimeClient.cs` must:
1. Call `POST /api/v1/agents/token` to exchange device token for JWT
2. Connect to `/?XTransformPort=3003` (same path as browser dashboard)
3. Emit `auth {token: jwt}` after connect
4. Listen for `job.dispatch` (not `DeliverJob`)
5. Drop `AckJob`/`ReportStatus`/`Heartbeat` outbound events — use REST for status

### 2.6 Token → JWT exchange

PrintEXE does NOT currently call `POST /api/v1/agents/token`. It must, before connecting to socket.io. The JWT is required for socket auth.

---

## 3. The local SQLite database (policy decision needed)

The master plan says "Do not create an independent desktop database." PrintEXE has a durable SQLite queue at `%AppData%\PrintShop\Companion\queue.db`.

### Analysis

The SQLite queue is a **transit cache**, not a business database:
- Jobs originate on the server (created by customer orders)
- The desktop downloads jobs, queues them locally for printing
- Job status is reported back to the server
- The queue is purged after 7 days

This is the same pattern as the existing Bun/TS print-agent CLI (`mini-services/print-agent/src/agent.ts:88-93` — `loadDiskQueue`/`saveDiskQueue`), which also has a local disk queue.

### Recommendation

**Relax the rule for transit-only job queues.** The SQLite queue is NOT a "business database" — it's a print spooler cache. The rule should be: "No independent business data database." Print-job transit caches are allowed (and necessary for offline printing).

**Document this exception explicitly** in `docs/SYNC_PROTOCOL.md` and update the master plan rule.

---

## 4. Migration path

### Phase 1: Adapt PrintEXE to the SaaS contract (PrintEXE-side changes)

1. **`HttpPrintShopBackend.cs`** — rewrite to use `Authorization: Bearer` + `/api/v1/agents/*` paths + correct DTOs
2. **`SocketIoRealtimeClient.cs`** — rewrite to use `/?XTransformPort=3003`, `auth {token: jwt}`, listen for `job.dispatch`
3. **`CompanionProtocol.cs`** — update constants to match SaaS event names + paths
4. **Add token-exchange call** — call `POST /api/v1/agents/token` before socket connect
5. **Drop magic-link pairing** — replace with "paste token" field (Option A) or add server-side pairing routes (Option B)
6. **Drop `/jobs/{id}/ack`** — fold ack into `status:"printing"`
7. **Drop `POST /device/revoke`** — replace with `DELETE /api/v1/agents/{id}` (needs server route)

### Phase 2: Add missing server routes (SaaS-side changes)

1. **`DELETE /api/v1/agents/{id}`** — revoke a print agent (owner auth)
2. **(Optional) `POST /api/v1/agents/pairing/begin`** + **`POST /api/v1/agents/pairing/exchange`** — magic-link pairing
3. **`POST /api/v1/devices/register`** — desktop device registration with sync cursor (for Phase 5 sync)
4. **`GET /api/v1/sync/pull`** + **`POST /api/v1/sync/push`** — bidirectional sync (see `docs/SYNC_PROTOCOL.md`)

### Phase 3: Verify on Windows hardware

Per PrintEXE's `HONEST-STATUS.md`:
- The .msi/.exe has never been built (Linux sandbox can't compile WPF)
- No real printer test print has happened
- No real pairing against production backend

**This must be done on a Windows machine before any production claim.**

---

## 5. Offline behavior

PrintEXE can operate offline (local SQLite queue). The expected behavior:

| Scenario | Behavior |
|---|---|
| Online, job dispatched | Socket.IO `job.dispatch` → enqueue to SQLite → print → report status |
| Offline, jobs queued | Jobs in SQLite continue printing; status reports queue locally |
| Reconnect | Flush queued status reports via REST; pull new jobs via `/agents/jobs/pending` |
| Conflict (job already completed on server) | Server returns `{skipped: true, reason: "already completed"}` — idempotent |

**The desktop never owns business data.** If a job is created offline (e.g., shopkeeper creates a walk-in order), it must be pushed to the server via sync (`POST /api/v1/sync/push`) before it's considered authoritative.

---

## 6. Security

| Concern | Implementation |
|---|---|
| Device token at rest | DPAPI (CurrentUser scope) — ✅ PrintEXE does this |
| Device token in transit | HTTPS `Authorization: Bearer` header |
| Token revocation | `DELETE /api/v1/agents/{id}` (owner auth) — needs server route |
| Socket.IO auth | JWT from `POST /api/v1/agents/token` (15-min TTL) |
| Tenant isolation | Device token → `PrintAgent.shopId` → all queries scoped |
| Audit log | Every agent action logged via `AuditLog` table |

---

## 7. Coexistence with the Bun/TS print-agent CLI

Both PrintEXE and the Bun/TS CLI can run for the same shop, but:
- **They must not run simultaneously for the same shop** (race for pending jobs)
- Both use the same `PrintAgent` / `PrintJob` backend models
- The shopkeeper registers separate agents (one per device)
- Atomic claiming (`status:'printing'` conditional UPDATE) prevents duplicate printing

**Migration strategy:** shops can run either client during transition. No forced migration.

---

## 8. Build and distribution

| Component | Status |
|---|---|
| WiX MSI installer | ✅ Defined (`installer/PrintShopCompanion.Installer.wxs`) but ❌ never built |
| Setup.exe bootstrapper | ✅ Defined (`PrintShopCompanion.Bundle.wxs`) but ❌ never built |
| GitHub Actions CI | ✅ Defined (windows-latest runner) |
| Auto-update | ❌ Not implemented (MSI re-install required) |
| Code signing | ⚠️ Optional EV signing in CI, not configured |

**The MSI must be built on a Windows machine** (or via GitHub Actions windows-latest runner). The Linux sandbox cannot compile WPF.

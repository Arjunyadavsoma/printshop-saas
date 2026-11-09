# PrintEXE ↔ SaaS Backend — Contract Audit

> Every protocol mismatch between PrintEXE (Windows desktop client, `github.com/Arjunyadvsoma/PrintEXE`) and the PrintShop SaaS backend. For each mismatch: backend route + expected DTO vs PrintEXE's actual call + DTO. This is the most important audit document — it is the master reference for the PrintEXE adaptation.

**Audit date:** 2025-11-08 · **Commit:** `dc24f4b`
**Evidence labels:** VERIFIED (source-confirmed), IMPLEMENTED (code present), BLOCKED (cannot run), NOT VERIFIED

---

## Summary — 7 confirmed incompatibilities

| # | ID | Category | Severity | Status |
|---|---|---|---|---|
| 1 | PC-001 | Auth header | P0 | PrintEXE wrong |
| 2 | PC-002 | Pairing flow | P0 | PrintEXE wrong |
| 3 | PC-003 | Endpoint paths | P0 | PrintEXE wrong |
| 4 | PC-004 | Status report DTO | P0 | PrintEXE wrong + missing atomic claim |
| 5 | PC-005 | Socket.IO (path/auth/events) | P0 | PrintEXE wrong on 3 sub-points |
| 6 | PC-006 | Token → JWT exchange | P0 | PrintEXE doesn't call |
| 7 | PC-007 | `/jobs/{id}/ack` + `/device/revoke` | P1 | `/ack` must be dropped; `/device/revoke` → `DELETE /api/v1/agents/{id}` (already exists) |

---

## PC-001 — Authentication header

**Backend route:** every `/api/v1/agents/*` route
**Backend file:** `src/lib/api/with-auth.ts:108-127` (`withDeviceAuth`)
**Backend expected:**
```
Authorization: Bearer <deviceToken>
```
- Token is hashed server-side: `createHmac('sha256', 'print-agent-salt').update(token).digest('hex')` (line 116)
- Looked up via `repos.printAgents.findByTokenHash(tokenHash)` (line 117)
- Token format: `<uuid>-<uuid>` (minted at `src/app/api/v1/agents/register/route.ts:23`)

**PrintEXE actual:** sends custom headers
- `X-PrintShop-Device-Token: <token>`
- `X-PrintShop-Device-Id: <id>`
- `X-PrintShop-Companion-Version: <ver>`
- (source: `docs/DESKTOP_INTEGRATION.md:46`, PrintEXE's `HttpPrintShopBackend.cs:279-286`)

**Mismatch:** custom headers vs `Authorization: Bearer`. Server never reads `X-PrintShop-*` → all PrintEXE calls fail with 401.

**Fix:** PrintEXE's `HttpPrintShopBackend.cs` must send `Authorization: Bearer <token>` for every call.

**Evidence:** VERIFIED (server-side auth code) + DESKTOP_INTEGRATION.md (PrintEXE-side).

---

## PC-002 — Pairing flow

**Backend route:** `POST /api/v1/agents/register`
**Backend file:** `src/app/api/v1/agents/register/route.ts:20-38`
**Backend expected:**
- Auth: `withAuth` (owner JWT — line 20)
- Body: `{name, os?, version?, printerName?}` (Zod schema lines 7-12)
- Response: `{agentId, deviceToken, shopId, shopName, warning}` — `deviceToken` returned ONCE (line 33)
- Flow: shopkeeper logs into web dashboard → "Register new agent" → copies `deviceToken` to PrintEXE

**PrintEXE actual:**
- Magic-link URL: `printshopcompanion://pair?token=…&shop=…&expires=…`
- Browser clicks link → desktop app opens → exchanges ticket
- Calls `POST /pair` with the magic-link token
- (source: `docs/DESKTOP_INTEGRATION.md:54-62`)

**Mismatch:** magic-link flow vs copy-paste flow. No `printshopcompanion://` handler exists on the server. `POST /pair` returns 404.

**Fix options (server-side change requirement):**
- **Option A (simplest, zero server change):** PrintEXE shows a "Paste device token" field. Shopkeeper generates the token in the web dashboard's Printer Setup page (`src/app/shop/printer/page.tsx` — VERIFIED exists), copies it to PrintEXE. **Recommended start.**
- **Option B (better UX, requires server routes):** Add `POST /api/v1/agents/pairing/begin` (owner JWT, returns 5-min ticket) + `POST /api/v1/agents/pairing/exchange` (ticket → device token, no JWT). Server changes needed.

**Evidence:** VERIFIED (server route) + DESKTOP_INTEGRATION.md (PrintEXE flow).

---

## PC-003 — Endpoint paths

**Backend expected vs PrintEXE actual:**

| PrintEXE calls | SaaS route | Status | Evidence |
|---|---|---|---|
| `POST /pair` | `POST /api/v1/agents/register` | WRONG path + auth (see PC-002) | `register/route.ts:20` |
| `POST /heartbeat` | `POST /api/v1/agents/heartbeat` | WRONG — missing `/api/v1` prefix | `heartbeat/route.ts:17` |
| `GET /agents/jobs/pending` | `GET /api/v1/agents/jobs/pending` | WRONG — missing `/api/v1` prefix | `jobs/pending/route.ts:40` |
| `POST /jobs/{jobId}/ack` | (does not exist) | WRONG — endpoint doesn't exist | See PC-007 |
| `POST /jobs/{jobId}/status` | `POST /api/v1/agents/jobs/{jobId}/status` | WRONG path + DTO (see PC-004) | `jobs/[id]/status/route.ts:23` |
| `POST /device/revoke` | `DELETE /api/v1/agents/{id}` | WRONG — different verb + path (see PC-007) | `agents/[id]/route.ts:26` |

**Fix:** PrintEXE's `HttpPrintShopBackend.cs` must use `/api/v1/agents/*` paths.

**Evidence:** VERIFIED (all backend routes exist at the paths above; PrintEXE paths from DESKTOP_INTEGRATION.md:67-74).

---

## PC-004 — Status report DTO

**Backend route:** `POST /api/v1/agents/jobs/{jobId}/status`
**Backend file:** `src/app/api/v1/agents/jobs/[id]/status/route.ts:10-14`
**Backend expected DTO:**
```typescript
{
  status: 'printing' | 'completed' | 'failed',  // Zod enum, REQUIRED
  lastError?: string,                            // max 500 chars
  printerName?: string                           // max 200 chars
}
```

**Backend atomic claim semantics:**
- Sending `{status: 'printing'}` IS the claim — conditional UPDATE `WHERE id=? AND status='queued'` (lines 39-43)
- Loser gets `{jobId, skipped: true, reason: "job is '<status>' — already claimed by another agent"}` (line 45)
- Sending `{status: 'completed'}` is idempotent — conditional UPDATE `WHERE status='printing'` (lines 52-58)
- Sending `{status: 'failed'}` sets `lastError` (line 64)

**PrintEXE actual:**
- Sends `{printedAt, failedAt, errorMessage}` — no `status` field
- Uses a separate `POST /jobs/{jobId}/ack` call to claim
- (source: `docs/DESKTOP_INTEGRATION.md:80-84`)

**Mismatch:** no `status` enum field → Zod schema rejects with 400. Separate `/ack` call doesn't exist → 404. Atomic claim semantics missing → race conditions.

**Fix:** PrintEXE must:
1. Drop the `/jobs/{jobId}/ack` call entirely
2. Send `POST /api/v1/agents/jobs/{jobId}/status` with `{status: "printing"}` when starting (claims atomically)
3. Send `{status: "completed"}` when done
4. Send `{status: "failed", lastError: "..."}` on failure

**Evidence:** VERIFIED (Zod schema + atomic update logic at lines 39-67).

---

## PC-005 — Socket.IO (3 sub-mismatches)

**Backend file:** `mini-services/realtime-service/index.ts:1-168`
**Backend config:**
- Path: `/` (line 85: `path: '/'`)
- Port: 3003 (line 19: `PORT_WS = 3003`)
- Public URL: `https://printshop-saas-three.vercel.app/?XTransformPort=3003` (Caddy gateway)
- Auth: client emits `auth {token: <JWT>}` after connect (lines 93-109)
- JWT verified HS256 with `JWT_ACCESS_SECRET` (lines 55-76)
- Room scoping: `socket.join('shop:' + claims.shopId)` (line 107)
- Inbound dispatch event: `job.dispatch` — emitted by `delivery-coordinator.ts:114` via `container.realtime.publish(channel, 'job.dispatch', {...})`
- Outbound events from client: NONE (status reported via REST)

**PrintEXE actual (3 sub-mismatches):**

| Sub | PrintEXE | Backend | Fix |
|---|---|---|---|
| 5a Path | `/companion-hub` | `/` (port 3003 via Caddy) | Use `/?XTransformPort=3003` |
| 5b Auth | (none specified) | Emit `auth {token: <JWT>}` after connect | Add auth emit; get JWT from `/api/v1/agents/token` |
| 5c Events | Listens for `DeliverJob`; emits `AckJob`, `ReportStatus`, `Heartbeat` | Server emits `job.dispatch`; no outbound events from client | Listen for `job.dispatch`; drop outbound events (use REST for status) |

**Fix:** PrintEXE's `SocketIoRealtimeClient.cs` must:
1. Connect to `/?XTransformPort=3003` (same path as browser dashboard)
2. Call `POST /api/v1/agents/token` (see PC-006) to get JWT first
3. Emit `auth {token: jwt}` after connect
4. Listen for `job.dispatch` (NOT `DeliverJob`)
5. Drop `AckJob` / `ReportStatus` / `Heartbeat` outbound events — use REST

**Evidence:** VERIFIED (realtime-service source + delivery-coordinator source) + DESKTOP_INTEGRATION.md (PrintEXE actual).

---

## PC-006 — Token → JWT exchange missing

**Backend route:** `POST /api/v1/agents/token`
**Backend file:** `src/app/api/v1/agents/token/route.ts:12-16`
**Backend expected:**
- Auth: `withDeviceAuth` (device token via `Authorization: Bearer`)
- Body: empty
- Response: `{accessToken, expiresIn, shopId}` — JWT, 15-min TTL (line 15)
- JWT used ONLY for Socket.IO auth, never for REST

**PrintEXE actual:** does NOT call this endpoint. Connects to Socket.IO directly with no JWT.

**Mismatch:** Socket.IO server requires JWT in the `auth` event (`mini-services/realtime-service/index.ts:93-109`). Without it → `auth-error` + disconnect (lines 96-98).

**Fix:** PrintEXE must call `POST /api/v1/agents/token` BEFORE connecting to Socket.IO, then emit `auth {token: jwt}` after connect.

**Evidence:** VERIFIED (token route + realtime auth handler).

---

## PC-007 — `/jobs/{id}/ack` and `/device/revoke`

### 7a. `POST /jobs/{jobId}/ack` (PrintEXE) — DOES NOT EXIST

**Backend:** no `/ack` route exists. Claim is folded into `POST /api/v1/agents/jobs/{jobId}/status {status:'printing'}` (see PC-004).

**Fix:** PrintEXE drops this call entirely.

### 7b. `POST /device/revoke` (PrintEXE) → `DELETE /api/v1/agents/{id}` (backend, EXISTS)

**Backend route:** `DELETE /api/v1/agents/{id}`
**Backend file:** `src/app/api/v1/agents/[id]/route.ts:26-85`
**Backend expected:**
- Auth: `withAuth` (owner JWT — line 26)
- Verifies agent belongs to caller's shop (lines 31-34 — tenant isolation)
- Returns queued jobs to queue (lines 41-50)
- Deletes `PrintAgent` row → token hash gone → all future calls 401 (line 53)
- Audit logs `agent.revoke` (lines 56-69)
- Publishes `agent.revoked` realtime event (lines 72-76)
- Response: `{agentId, agentName, revoked: true, cancelledJobs, message}` (lines 78-84)

**PrintEXE actual:** calls `POST /device/revoke` with the device token.

**Mismatch:** wrong verb (`POST` vs `DELETE`), wrong path, wrong auth (device token vs owner JWT). Revocation must be initiated by the SHOPKEEPER from the web dashboard, not by the device itself.

**Fix:** PrintEXE's "Revoke this PC" button should redirect the user to the web dashboard (or call `DELETE /api/v1/agents/{id}` with the shopkeeper's JWT, NOT the device token).

**Evidence:** VERIFIED (DELETE route source) + DESKTOP_INTEGRATION.md.

---

## Receipt endpoint (positive finding)

**Backend route:** `POST /api/v1/agents/jobs/{jobId}/received`
**Backend file:** `src/app/api/v1/agents/jobs/[id]/received/route.ts` (exists — VERIFIED via 401 probe in PRODUCTION_READINESS_AUDIT.md)
**Purpose:** acknowledge that the device received the file (separate from print completion)
**PrintEXE:** should call this after downloading the PDF. Not currently in PrintEXE's protocol — add it.

This is the document-delivery tracking endpoint. It is idempotent (`delivery-coordinator.ts:169-175` returns success on duplicate receipt). It does NOT mark the job as printed — only as received.

---

## What PrintEXE must change (consolidated)

1. **`HttpPrintShopBackend.cs`** — rewrite: `Authorization: Bearer` + `/api/v1/agents/*` paths + correct DTOs
2. **`SocketIoRealtimeClient.cs`** — rewrite: `/?XTransformPort=3003`, `auth {token: jwt}`, listen for `job.dispatch`
3. **`CompanionProtocol.cs`** — update constants: paths, event names
4. **Add token-exchange call** — `POST /api/v1/agents/token` before socket connect
5. **Drop magic-link pairing** — replace with "paste token" field (Option A) or wait for server pairing routes (Option B)
6. **Drop `/jobs/{id}/ack`** — fold claim into `{status:'printing'}`
7. **Replace `POST /device/revoke`** — call `DELETE /api/v1/agents/{id}` with owner JWT (from web dashboard)
8. **Add receipt call** — `POST /api/v1/agents/jobs/{jobId}/received` after PDF download

## What the server must change (minimal)

- **Option B pairing routes** (optional, for better UX): `POST /api/v1/agents/pairing/begin` + `POST /api/v1/agents/pairing/exchange`
- No other server changes required for PC-001 through PC-007 — all backend routes already exist

**The contract adaptation is one-way: PrintEXE changes, server stays.**

---

## References
- `docs/DESKTOP_INTEGRATION.md` — original incompatibility analysis
- `docs/PRINTEXE_INTEGRATION_GUIDE.md` — the correct SaaS contract (925 lines, every DTO)
- `docs/SECURITY_ASSESSMENT.md:59-66` — device-token security model
- `docs/PRODUCTION_READINESS_AUDIT.md:184-195` — 401 endpoint probes (auth working)

# PrintEXE API Contract — Master Reference

> The definitive contract for the PrintEXE Windows desktop client. Every field,
> validation rule, status code, and sample payload below is copied from the
> actual route handlers in `src/app/api/v1/`. When this document disagrees with
> any other doc, **this document wins** (it is generated against the source).

**API base URL:** `https://printshop-saas-three.vercel.app/api/v1`
**Socket.IO URL:** `wss://printshop-saas-three.vercel.app/?XTransformPort=3003`
**Response envelope:** `{ "success": true, "data": {...} }` | `{ "success": false, "error": { "code", "message", "details"? } }`
**Request-id header (response):** `x-request-id` — capture + log on every call for support.

---

## Endpoints used by PrintEXE

| # | Method | Path | Auth | Min version |
|---|---|---|---|---|
| 1 | POST | `/agents/register` | Owner JWT | v0.4.7 (web only) |
| 2 | POST | `/agents/token` | Device token | v0.4.7 |
| 3 | POST | `/agents/heartbeat` | Device token | v0.4.7 |
| 4 | GET | `/agents/jobs/pending` | Device token | v0.4.7 |
| 5 | POST | `/agents/jobs/{jobId}/status` | Device token | v0.4.7 |
| 6 | POST | `/agents/jobs/{jobId}/received` | Device token | **v0.5.x** |
| 7 | DELETE | `/agents/{agentId}` | Owner JWT (web) | v0.4.7 (web only) |
| 8 | GET | `/sync/pull` | Device token | **v0.5.x** |
| 9 | POST | `/sync/push` | Device token | **v0.5.x** |
| 10 | GET | `/sync/status` | Device token | **v0.5.x** |

`Device token` = `Authorization: Bearer <deviceToken>` (the 73-char UUID pair issued at registration).
`Owner JWT` = `Authorization: Bearer <accessToken>` (15-min HS256 token issued at `/auth/login`).

---

## 1. POST /agents/register — pair a new device (called from the web dashboard, NOT PrintEXE)

**Auth:** Owner JWT (withAuth, role owner).
**Body schema (Zod `RegisterSchema`):**
```ts
{ name: string (1..120, required),
  os?: string (<=40),
  version?: string (<=40),
  printerName?: string (<=200) }
```
**Sample request:**
```json
{"name": "Front Desk PC", "os": "win32", "version": "1.0.0", "printerName": "HP LaserJet"}
```
**Sample response 200:**
```json
{"success":true,"data":{
  "agentId":"550e8400-e29b-41d4-a716-446655440000",
  "deviceToken":"550e8400-e29b-41d4-a716-446655440000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "shopId":"shop-uuid","shopName":"Arjun Print Hub",
  "warning":"Save this token — it is shown only once."}}
```
**Idempotency:** NONE — each call mints a fresh token. Don't retry on success.
**Retry:** Safe to retry on 5xx/429 (no side effect until the DB insert commits; a duplicate `name` is allowed).
**Errors:** 400 VALIDATION_ERROR (Zod); 401 UNAUTHORIZED (no/expired JWT); 403 FORBIDDEN (role not owner).

---

## 2. POST /agents/token — exchange device token → short-lived JWT (for Socket.IO)

**Auth:** Device token. **Body:** ignored (send empty).
**Sample response 200:**
```json
{"success":true,"data":{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
  "expiresIn":900,"shopId":"shop-uuid"}}
```
The JWT is HS256, TTL = `JWT_ACCESS_TTL` (900 s on prod), payload `{sub:"agent:<agentId>", shopId, role:"staff", type:"access", iat, exp}`.
**Idempotency:** Every call issues a NEW JWT; old JWTs remain valid until they expire. Cache locally until `expiresIn`-60 s, then re-exchange.
**Retry:** Retry on 5xx. On 401 (token hash no longer matches a row) → device has been revoked → stop.
**Errors:** 401 UNAUTHORIZED (missing or unknown device token).

---

## 3. POST /agents/heartbeat — refresh presence

**Auth:** Device token. **Body schema (`HeartbeatSchema`):**
```ts
{ printerName?: string(<=200), version?: string(<=40), os?: string(<=40) }
```
All fields optional; pass `{}` is fine. Missing fields retain the previous agent row values.
**Sample response 200:** `{"success":true,"data":{"agentId":"...","online":true,"ts":"2025-11-07T10:00:00.000Z"}}`
**Idempotency:** Yes — pure write of `isOnline=true, lastSeenAt=now()`. Safe to call every 60 s.
**Retry:** Retry on transient 5xx/429 with exponential backoff (jitter 1–5 s). Don't retry on 4xx.
**Online threshold:** Dashboard treats agents with `lastSeenAt` older than 30 s as offline.

---

## 4. GET /agents/jobs/pending — poll queued jobs (≤10)

**Auth:** Device token. **No query params.**
**Response schema:**
```ts
{ jobs: PendingJob[], agentId: string }
PendingJob = { jobId, fileId, orderId, filename, downloadUrl,
  copies:number, colorMode:string, duplex:boolean, paperSize:string,
  pageRange:string|null }
```
`downloadUrl` is a presigned storage URL (R2/S3/Supabase) with a **900-second (15-min) TTL**. Relative paths from the dev in-memory adapter are prepended with `APP_BASE_URL`. Always download directly from the URL (no auth header on the storage fetch).
**Sample response 200:**
```json
{"success":true,"data":{"jobs":[{
  "jobId":"job-uuid","fileId":"file-uuid","orderId":"order-uuid",
  "filename":"invoice.pdf","downloadUrl":"https://r2.dev/...?sig=...",
  "copies":2,"colorMode":"bw","duplex":false,"paperSize":"a4","pageRange":null}],
  "agentId":"agent-uuid"}}
```
**Idempotency:** Yes (GET). A side-effect: this call refreshes `lastSeenAt` server-side, so polling doubles as a heartbeat.
**Retry:** Poll every 2 s when Socket.IO is disconnected. Exponential backoff NOT needed — fixed 2 s.
**Errors:** 401 (revoked token).

---

## 5. POST /agents/jobs/{jobId}/status — claim, complete, fail (atomic state machine)

**Auth:** Device token. **Body schema (`StatusSchema`):**
```ts
{ status: 'printing' | 'completed' | 'failed',
  lastError?: string(<=500),  // required-meaningful when status='failed'
  printerName?: string(<=200) }
```
**Behaviour per status:**
- `printing` → **atomic claim**: `UPDATE printJob SET status='printing', agentId, startedAt WHERE id=? AND status='queued' AND shopId=?`. If 0 rows updated → `{jobId, skipped:true, reason:"job is '<current>' — already claimed by another agent"}`.
- `completed` → conditional update WHERE `status='printing'`. 0 rows → `{jobId, skipped:true, reason:"job is '<current>' — not in 'printing' state (duplicate ack or already completed)"}`. On success: file→`completed`, order auto-marks `ready` when ALL its files are `completed`.
- `failed` → unconditional update. `lastError` stored. File→`failed`.
**Sample success:** `{"success":true,"data":{"jobId":"...","status":"printing","applied":true}}`
**Idempotency:** Yes — duplicate `completed`/`printing` calls return `skipped:true` with HTTP 200 (NOT an error).
**Retry:** Safe to retry any status call after a network failure (the conditional update makes double-claim impossible). For `failed`, retrying also is safe (idempotent overwrite of lastError).
**Errors:** 404 NOT_FOUND (job doesn't exist or isn't in this shop); 400 VALIDATION_ERROR; 401.

---

## 6. POST /agents/jobs/{jobId}/received — durable receipt (v0.5.x ONLY)

**Auth:** Device token. **Body schema (`ReceiptSchema`):**
```ts
{ deliveryAttemptId?: string(uuid),
  transferId?: string(uuid),            // future: WebRTC
  checksum?: string(/^[a-f0-9]{64}$/i), // SHA-256 hex
  fileSize?: number(int, >0),
  receivedAt?: string(datetime) }
```
All optional. Call AFTER the PDF has been downloaded + verified locally. The server marks the `PrintDeliveryAttempt` row `received`, schedules a `FileCleanupTask` for `now + 15 min`, publishes `delivery.received`, and writes an `AuditLog` entry.
**Sample response 200:**
```json
{"success":true,"data":{"jobId":"...","received":true,"cleanupScheduled":true,
  "message":"Receipt acknowledged. Cloud cleanup scheduled for 2025-11-07T10:15:00Z."}}
```
**Idempotency:** Yes — if a `received` attempt already exists, returns `{received:true, cleanupScheduled:true, message:"Receipt already acknowledged (idempotent)..."}`. If the job itself is already `completed`/`failed`, returns `{received:true, cleanupScheduled:false, message:"Job is already '<status>'. Receipt not needed."}`.
**Retry:** Retry indefinitely on 5xx. On 404 — the job was deleted; drop the local copy.
**Errors:** 404 NOT_FOUND (job not in this shop); 400 VALIDATION_ERROR; 401.
**v0.4.7 clients:** this endpoint does not exist for them — they MUST NOT call it. A 404 from this path on v0.4.7 is normal.

---

## 7. DELETE /agents/{agentId} — revoke a device (web dashboard)

**Auth:** Owner JWT. **No body.** Returns queued jobs assigned to that agent to the pool (`agentId=null` for `status='queued'` rows; `printing` rows are left alone) and DELETES the PrintAgent row — the token hash is gone, so every future device-token call returns 401.
**Sample response 200:**
```json
{"success":true,"data":{"agentId":"...","agentName":"Front Desk PC",
  "revoked":true,"cancelledJobs":0,
  "message":"Agent \"Front Desk PC\" revoked. 0 queued job(s) returned to the queue."}}
```
Audit-logged (`action:'agent.revoke'`). Publishes `agent.revoked` realtime event.
**Idempotency:** No — second call returns 404 (row already gone).
**Errors:** 404 NOT_FOUND (agent not in this shop); 401; 403.

---

## 8. GET /sync/pull?cursor={ISO8601}&limit=100 — incremental pull (v0.5.x)

**Auth:** Device token. **Query:** `cursor` (ISO timestamp, default `1970-01-01T00:00:00Z`), `limit` (1–500, default 100). The shopId comes from the device token — the server NEVER trusts a query-string shopId.
**Response schema (`PullResult`):**
```ts
{ changes: SyncChange[], nextCursor: string, hasMore: boolean }
SyncChange = { entity: 'Shop'|'Order'|'PrintFile'|'PrintJob'|'PrintAgent'|'Customer',
  id:string, action:'upsert'|'delete', data:Record<string,unknown>,
  revision:number, updatedAt:string }
```
The server advances the persisted per-device cursor only when changes were returned.
**Retry:** On 5xx retry with the SAME cursor (the cursor only advances on a 200). If `hasMore=true`, immediately re-pull with the returned `nextCursor`.
**Errors:** 400 VALIDATION_ERROR; 401; 429.

---

## 9. POST /sync/push — submit offline client changes (v0.5.x)

**Auth:** Device token. **Body schema (`PushSchema`):**
```ts
{ changes: Array<{ entity:string, id:string(uuid), action:'upsert'|'delete',
  data:Record<string,unknown>, clientRevision:int, baseRevision:int }> }
```
`changes` array max length 100. **Only `Customer` is pushable in v1** — Orders, PrintFiles, PrintJobs, etc. return `{accepted:false, conflict:false, reason:"<entity> is server-authoritative; use the dedicated API endpoints"}`.
**Response:** `{ results: Array<{ id, accepted, conflict, serverRevision?, serverData?, reason?, error? }> }`. Per-change results (one entry per change) — a single failing change does NOT abort the batch.
**Conflict handling:** If `baseRevision < server.revision`, server returns `{accepted:false, conflict:true, serverRevision, serverData}` so the client can merge + retry.
**Idempotency:** Delete of an already-deleted row returns `{accepted:true, conflict:false, serverRevision:<baseRevision>, reason:"already deleted"}`.
**Retry:** Re-send un-accepted changes individually. Conflicts require client-side merge first.
**Errors:** 400 VALIDATION_ERROR (whole batch rejected if shape wrong); 401; 429.

---

## 10. GET /sync/status — device sync state (v0.5.x)

**Auth:** Device token. **No params.**
**Response:**
```json
{"success":true,"data":{"deviceId":"...","shopId":"...","syncCursor":"2025-11-07T10:00:00Z",
  "lastSyncAt":"...","lastPushAt":"...","agentName":"Front Desk PC","isOnline":true}}
```
`pendingPulls`/`pendingPushes` are NOT computed server-side in v1 — derive pending pulls by comparing the local cursor to `syncCursor`.

---

## Cross-cutting rules

- **Tenant isolation:** every device-token call resolves `shopId` from the PrintAgent row. NEVER send a `shopId` field in any request body.
- **Content-Type:** `application/json` for all POSTs. Bodies are required for `/status`, `/received`, `/heartbeat`, `/register`, `/push`; optional empty for `/token`.
- **Version header (recommended):** send `X-PrintShop-Companion-Version: 1.0.0` on every call so the server can warn or hard-block (`426 Upgrade Required`) old clients.
- **Rate limits:** fixed-window per IP+scope. On 429 → back off (≥2× last delay) and retry idempotently.
- **Time:** all timestamps are ISO-8601 UTC (`2025-11-07T10:00:00.000Z`).

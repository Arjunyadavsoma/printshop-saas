# PrintShop Companion API Contract v1

**Version:** 1.1
**Status:** ACTIVE — single source of truth (SSOT)
**Machine-readable artifact:** [`companion-v1.schema.json`](./companion-v1.schema.json) (generated from `src/lib/contracts/companion.ts` Zod schemas — do not edit by hand)
**Last verified against code:** 2026-11-20 (commit `74188c4` + Phase 1) — every claim below was checked against the route handlers; drift found in v1.0 is fixed and marked in the changelog (§17).
**Repository:** `Arjunyadavsoma/printshop-saas`
**Companion:** `Arjunyadavsoma/PrintEXE`

This document is the authoritative API contract between the PrintShop SaaS cloud backend and the PrintEXE Windows companion application. PrintEXE must implement against this contract exactly. Do not invent endpoints, payloads, or authentication rules not documented here. The other files in `docs/integration/` are historical working notes — when they disagree with this document, **this document wins**.

**Change rules:** additive changes (new optional fields, new events, new endpoints) bump the minor version and must be backwards-compatible; breaking changes bump to `/api/v2` and require a new contract document. Every change requires: (1) updating the Zod schemas in `src/lib/contracts/companion.ts`, (2) regenerating `companion-v1.schema.json`, (3) updating this document, (4) updating the PrintEXE copy + its contract test. The contract tests in both repos fail CI on drift.

---

## 1. Pairing-Ticket Creation

**Endpoint:** `POST /api/v1/companion/pairing/begin`

**Authentication:** Bearer JWT (shopkeeper — `owner` or `staff` role)

**Request:**
```http
POST /api/v1/companion/pairing/begin
Authorization: Bearer <shopkeeper-jwt>
Content-Type: application/json
```
No request body required.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "ticket": "a1b2c3d4e5f6...(64 hex chars)",
    "pairingUrl": "printshop://pair?ticket=a1b2c3d4...&shop=<shopId>",
    "expiresAt": "2026-11-16T12:35:00.000Z",
    "shopId": "uuid-here"
  }
}
```

**Rate limit:** 5 requests per 60 seconds per user.

**Security:**
- Ticket is 32 bytes of `crypto.randomBytes` → hex (256-bit entropy).
- Only `SHA-256(ticket)` is stored in the database (`PairingTicket.ticketHash`).
- Ticket expires 5 minutes after creation.
- Ticket is single-use — status transitions `active → consumed` atomically.
- Ticket is bound to the shopkeeper's shop ID (derived from JWT, never client-supplied).
- Raw ticket value is never logged.

**Error responses:**
| Status | Code | When |
|---|---|---|
| 401 | UNAUTHORIZED | Missing or invalid JWT |
| 403 | FORBIDDEN | User is not `owner` or `staff` |
| 403 | ENTITLEMENT_REQUIRED | Free-tier shop already has one paired/queued device (`multi_device` gate at MINT time) |
| 429 | RATE_LIMITED | More than 5 per minute (`withRateLimit('pairing-begin', 5, 60)`) |

---

## 2. Ticket Exchange (Pairing)

**Endpoint:** `POST /api/v1/companion/pair`

**Authentication:** None — the pairing ticket IS the authorization.

**Request:**
```http
POST /api/v1/companion/pair
Content-Type: application/json

{
  "ticket": "a1b2c3d4e5f6...(64 hex chars)",
  "deviceName": "Shop-Front-PC",
  "version": "1.0.0",
  "os": "Windows 11",
  "printerName": "HP LaserJet Pro"
}
```

**Validation:**
- `ticket`: required, 64 hex chars
- `deviceName`: required, 1-255 chars
- `version`: optional string
- `os`: optional string
- `printerName`: optional string

**Response (200):**
```json
{
  "success": true,
  "data": {
    "agentId": "uuid-here",
    "deviceToken": "e7f8a9b0c1d2...(64 hex chars)",
    "shopId": "uuid-here",
    "shopName": "QuickPrint Demo Shop",
    "protocolVersion": 1
  }
}
```

**Atomic consume:** The ticket status is updated from `active → consumed` using a conditional `WHERE status='active'`. Concurrent exchanges race — only the first succeeds. Losers receive 409.

**Device token generation:**
- 32 bytes `crypto.randomBytes` → hex (256-bit entropy)
- Stored as `v2:HMAC-SHA256(DEVICE_TOKEN_PEPPER, token)` → hex in `PrintAgent.tokenHash` (see §3)
- Raw token returned exactly once — never again
- Token never expires (until revoked or rotated)

**Error responses:**
| Status | Code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | Invalid ticket format or missing deviceName |
| 401 | UNAUTHORIZED | Ticket unknown **or expired** — deliberately indistinguishable so tickets cannot be enumerated |
| 409 | PAIRING_TICKET_CONSUMED | Lost the atomic consume race (ticket consumed between read and update) |
| 409 | PAIRING_TICKET_UNAVAILABLE | Ticket exists but status ≠ `active` (already used/expired row) |
| 403 | ENTITLEMENT_REQUIRED | Free plan (`multi_device` not entitled) and shop already has ≥1 enabled device — enforced at CONSUME time, plus a post-insert re-check that disables the second device |
| 429 | RATE_LIMITED | More than 10 per minute (`withRateLimit('pairing-consume', 10, 60)`) |

**Plan limit:** a free-tier shop may pair exactly ONE enabled Windows device. The gate runs at mint time (`/pairing/begin`), again at consume time, and a final post-insert re-count disables an over-limit device (it can never authenticate). Upgrade the subscription for `multi_device`.

---

## 3. Device-Token Authentication

All companion API routes (except `/companion/pair`) require device authentication.

**Header:**
```http
Authorization: Bearer <deviceToken>
```

**Verification process:**
1. Extract token from `Authorization` header
2. Compute the versioned HMAC of the token and compare against `PrintAgent.tokenHash` (length-guarded, timing-safe):
   - stored `v2:<hex>` → `HMAC-SHA256(DEVICE_TOKEN_PEPPER, token)` (current format — written by all new credential issuance: `/companion/pair`, `/companion/token/rotate`, `/agents/register`)
   - stored `<bare hex>` → legacy `HMAC-SHA256('print-agent-salt', token)` — accepted ONLY for devices paired before the versioned scheme; each device migrates to `v2:` when it calls `POST /api/v1/companion/token/rotate`
3. Look up `PrintAgent` where `tokenHash = <hex>`
4. If found → device is authenticated; `shopId` derived from the agent record
5. If `PrintAgent.isEnabled = false` → reject (403 `DEVICE_DISABLED`)
6. Update `isOnline = true`, `lastSeenAt = now` on every authenticated call

**Security rules:**
- Shop ID is ALWAYS derived from the PrintAgent record, never from client input
- A revoked device (deleted PrintAgent) cannot authenticate — hash lookup fails
- A disabled device (`isEnabled = false`) receives 403 `DEVICE_DISABLED` on all companion routes
- `DEVICE_TOKEN_PEPPER` (≥ 16 chars) is REQUIRED in production and validated at container build; development falls back to the legacy pepper so existing dev databases keep working. The pepper never reaches the browser, never enters logs
- After rotation the old hash is kept in `PrintAgent.prevTokenHash` for a 10-minute overlap window (§15) — during it BOTH tokens verify, but the old token cannot advance job state past `printing`
- Raw tokens are never logged, never returned after initial pairing/rotation

---

## 4. Device Heartbeat

**Endpoint:** `POST /api/v1/agents/heartbeat`

**Authentication:** Bearer device token

**Request:**
```json
{
  "printerName": "HP LaserJet Pro",
  "version": "1.0.0",
  "os": "Windows 11"
}
```
All fields optional.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "agentId": "uuid",
    "online": true,
    "ts": "2026-11-16T12:30:00.000Z"
  }
}
```

**Heartbeat interval:** 15 seconds (recommended). The server marks a device offline if no heartbeat is received within 30 seconds.

---

## 5. Device Metadata & Printer Inventory

**Endpoint:** `POST /api/v1/agents/heartbeat`

Printer inventory is reported via the heartbeat endpoint. The `printerName` field stores the currently selected printer. Future versions will add a dedicated printer inventory endpoint.

**Endpoint (shopkeeper view):** `GET /api/v1/shops/me/devices`

Returns all devices with their metadata:
```json
{
  "success": true,
  "data": {
    "devices": [
      {
        "id": "uuid",
        "name": "Shop-Front-PC",
        "isOnline": true,
        "isEnabled": true,
        "lastSeenAt": "2026-11-16T12:29:55.000Z",
        "printerName": "HP LaserJet Pro",
        "version": "1.0.0",
        "os": "Windows 11",
        "createdAt": "2026-11-16T12:00:00.000Z"
      }
    ]
  }
}
```

---

## 6. Command Retrieval

**Endpoint:** `GET /api/v1/companion/commands`

**Authentication:** Bearer device token

**Response (200):**
```json
{
  "success": true,
  "data": {
    "agentId": "uuid",
    "commands": [
      {
        "commandId": "uuid",
        "commandType": "refresh_printers",
        "payload": {},
        "issuedAt": "2026-11-16T12:30:00.000Z",
        "expiresAt": "2026-11-16T12:35:00.000Z"
      }
    ]
  }
}
```

Only commands with `status = 'requested'` and `expiresAt > now` are returned (`payload` is a JSON **object**, not a string). Expired commands are automatically marked `expired`. As a side effect the GET flips each returned command `requested → delivered` (best-effort, never clobbering a concurrent status report) so the dashboard can see the device received them.

---

## 7. Command Acknowledgement & Result Reporting

**Endpoint:** `POST /api/v1/companion/commands`

**Authentication:** Bearer device token

**Request:**
```json
{
  "commandId": "uuid",
  "status": "succeeded",
  "result": "{\"printers\":[\"HP LaserJet\",\"Canon MF\"]}"
}
```

**Status values:** `delivered`, `accepted`, `executing`, `succeeded`, `failed`, `outcome_unknown`

> `outcome_unknown` (Phase 3 addition): the companion reports this when a command was executing but the process crashed/restarted before confirming the side effect's result. This is a **terminal** state — the system must NEVER automatically re-execute or auto-fail these commands. The shopkeeper must manually resolve them (verify physical output, then mark succeeded or failed).

**Response (200):**
```json
{
  "success": true,
  "data": { "commandId": "uuid", "status": "succeeded", "updatedAt": "2026-11-16T12:31:00.000Z" }
}
```

**Idempotency:** Reporting the same `commandId` with the same (or an older) status is safe — terminal statuses (`succeeded`, `failed`, `outcome_unknown`) stamp `executedAt` exactly once and never re-process. There is no `applied` field; repeat reports simply return the command's current state.

---

## 8. Sending Commands (Shopkeeper)

**Endpoint:** `POST /api/v1/shops/me/devices/:deviceId/commands`

**Authentication:** Bearer JWT (owner or staff)

**Request:**
```json
{
  "commandType": "refresh_printers",
  "payload": "{}",
  "idempotencyKey": "unique-key-string"
}
```

**Command allowlist:**
| Command | Payload | Description |
|---|---|---|
| `refresh_printers` | `{}` | Refresh printer inventory from Windows |
| `pause` | `{}` | Pause print processing |
| `resume` | `{}` | Resume print processing |
| `cancel_job` | `{"jobId":"uuid"}` | Cancel a specific queued job |
| `retry_job` | `{"jobId":"uuid"}` | Retry a failed job |
| `test_print` | `{}` | Print a test page |
| `diagnostics` | `{}` | Collect and report diagnostics |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "commandId": "uuid",
    "status": "requested",
    "expiresAt": "2026-11-16T12:35:00.000Z"
  }
}
```

**Idempotency:** If a command with the same `idempotencyKey` already exists, the existing command is returned unchanged.

**Command expiry:** 5 minutes from creation.

---

## 9. Print-Job Dispatch

**Endpoint (polling):** `GET /api/v1/agents/jobs/pending`

**Authentication:** Bearer device token

**Response (200):**
```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "jobId": "uuid",
        "fileId": "uuid",
        "orderId": "uuid",
        "filename": "document.pdf",
        "downloadUrl": "https://signed-url...",
        "copies": 1,
        "colorMode": "bw",
        "duplex": false,
        "paperSize": "a4",
        "pageRange": null
      }
    ],
    "failedJobs": [],
    "agentId": "uuid"
  }
}
```

- Returns up to 10 queued jobs (oldest first)
- `downloadUrl` is a presigned URL with 900-second (15-min) TTL
- `failedJobs` lists this agent's jobs that previously failed and were re-queued for attention (same job shape) — empty when none
- Jobs are shop-scoped (only jobs for the device's shop)
- Each poll publishes an `agent.heartbeat` realtime event (cheap liveness signal)

---

## 10. Print-Job Status Updates

**Endpoint:** `POST /api/v1/agents/jobs/:jobId/status`

**Authentication:** Bearer device token

**Request:**
```json
{
  "status": "printing",
  "lastError": null,
  "printerName": "HP LaserJet Pro"
}
```

**Status values:** `printing`, `completed`, `failed`, `needs_review`

**Atomic claiming:** When `status = "printing"`, the server atomically updates `PrintJob WHERE id=? AND status='queued'`. If another device already claimed it, the response is:
```json
{
  "success": true,
  "data": { "jobId": "uuid", "skipped": true, "reason": "job is 'printing' — not in 'queued' state" }
}
```

Duplicate acknowledgements are ALWAYS safe: reporting a status the job is not eligible to transition to returns `{ jobId, skipped: true, reason }` instead of erroring (e.g. completing an already-completed job, `needs_review` on a `completed` job).

**Completion:** When `status = "completed"`, the server:
1. Updates `PrintJob.status = 'completed'`
2. Updates `PrintFile.status = 'completed'`, `printedAt = now`
3. If all files in the order are completed → `Order.status = 'ready'`
4. Publishes `job.completed` realtime event

**Failure:** When `status = "failed"`, the server:
1. Updates `PrintJob.status = 'failed'`, `lastError = <message>`, `attempts += 1`
2. Updates `PrintFile.status = 'failed'`
3. Publishes `job.failed` realtime event

**Needs review:** When `status = "needs_review"` (the companion saw ambiguous evidence — e.g. crash mid-print, spooler result unverifiable), the server moves the job to `needs_review` and publishes `job.needs_review`; the shopkeeper resolves it manually from the dashboard.

---

## 11. Socket.IO Authentication

**Connection URL:** `https://<domain>/?XTransformPort=3003`

The `XTransformPort=3003` query parameter routes through the Caddy gateway to the realtime mini-service on port 3003.

**Authentication handshake:**
```javascript
socket.emit('auth', { token: '<jwt-from-agents-token>' });
```

**JWT acquisition:**
```
POST /api/v1/agents/token
Authorization: Bearer <deviceToken>

Response: { accessToken: "<jwt>", expiresIn: 900, shopId: "<uuid>" }
```

The JWT is HS256-signed with `JWT_ACCESS_SECRET`, contains `{ sub: "agent:<agentId>", shopId, role: "staff", type: "access" }`, and expires in 15 minutes.

**Auth response:**
```javascript
// Success
socket.on('auth-ok', (data) => { /* data: { shopId, role } */ });
// Failure — the socket is disconnected by the server right after emitting
socket.on('auth-error', (data) => { /* data: { message: "invalid or expired token" } */ });
```

---

## 12. Socket.IO Event Names & Payloads

**Server → Device/Dashboard events (on `shop:<shopId>` channel):**

| Event | Payload | Source |
|---|---|---|
| `job.dispatch` | `{ jobId, fileId, orderId, filename, downloadUrl, copies, colorMode, duplex, paperSize, pageRange, deliveryAttemptId? }` | Print service |
| `job.printing` | `{ jobId, fileId }` | Agent status update |
| `job.completed` | `{ jobId, fileId }` | Agent status update |
| `job.failed` | `{ jobId, fileId, error? }` | Agent status update |
| `job.needs_review` | `{ jobId, fileId, ... }` | Agent reports ambiguous print evidence |
| `order.paid` | `{ orderId, amountPaise }` | Payment webhook |
| `order.ready` | `{ orderId }` | Auto-triggered when all files complete |
| `agent.heartbeat` | `{ agentId }` | Heartbeat ping (also emitted on each `/agents/jobs/pending` poll) |
| `agent.revoked` | `{ agentId, agentName, cancelledJobs }` | Device revocation |
| `delivery.received` | `{ jobId, agentId, agentName, receivedAt, checksum }` | Receipt acknowledgment |
| `device.command.issued` | `{ commandId, agentId, commandType }` | Command creation |
| `device.revoked` | `{ agentId }` | Device revocation |
| `device.token_rotated` | `{ agentId, ... }` | Token rotation (§15) |

**Client → Server events:**
| Event | Payload | Purpose |
|---|---|---|
| `auth` | `{ token: "<jwt>" }` | Authenticate the connection |

---

## 13. Reconnection & Polling Fallback

**Realtime (primary):** Socket.IO with automatic reconnection. The companion should use `socket.io-client` with:
- `reconnection: true`
- `reconnectionAttempts: Infinity`
- `reconnectionDelay: 1000` (1s initial)
- `reconnectionDelayMax: 30000` (30s max)
- Exponential backoff with jitter (built into socket.io-client)

**REST polling (fallback):** If Socket.IO is unavailable, the companion must continue operating via:
- `GET /api/v1/agents/jobs/pending` — poll every 2-5 seconds for new jobs
- `GET /api/v1/companion/commands` — poll every 2-5 seconds for new commands
- `POST /api/v1/agents/heartbeat` — send every 15 seconds

**Reconnect reconciliation:** After a Socket.IO reconnection:
1. Re-authenticate via `auth` event
2. Poll `/agents/jobs/pending` to catch any jobs dispatched during disconnection
3. Poll `/companion/commands` to catch any commands issued during disconnection
4. Resume heartbeat cadence

The database is the source of truth — realtime is a notification mechanism, not a persistence layer. Jobs and commands are persisted before realtime delivery.

---

## 14. Error Codes & Retry Behavior

**HTTP error response format:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Envelope rules (implemented in `src/lib/api/envelope.ts`):
- Success responses carry `{ success: true, data, meta? }`; errors carry `{ success: false, error }` — never both
- Every request gets an `X-Request-Id` response header (echoed from the caller's `x-request-id` header if present) for end-to-end tracing
- In production, non-`AppError` exceptions are masked: status 500 with `code: "INTERNAL_ERROR"` and a generic message (the real cause goes to Sentry/logs, correlated via `X-Request-Id`). Development returns the raw message for debugging
- Malformed JSON / schema violations → 400 `VALIDATION_ERROR` with `details.issues` from Zod

**Standard error codes:**
| Code | HTTP Status | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication (covers unknown AND expired pairing tickets — indistinguishable by design) |
| `FORBIDDEN` | 403 | Authenticated but not authorized |
| `NOT_FOUND` | 404 | Resource doesn't exist (or belongs to another shop) |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `RATE_LIMITED` | 429 | Too many requests (respect `Retry-After`) |
| `PAIRING_TICKET_UNAVAILABLE` | 409 | Pairing ticket exists but is not `active` |
| `PAIRING_TICKET_CONSUMED` | 409 | Pairing ticket consumed by a concurrent request |
| `DEVICE_DISABLED` | 403 | Device exists but `isEnabled = false` |
| `ENTITLEMENT_REQUIRED` | 403 | Plan limit hit (e.g. `multi_device`) |
| `INTERNAL_ERROR` | 500 | Unexpected server error (masked in production) |

**Retry behavior:**
- **429 (rate limited):** Wait `Retry-After` header seconds, then retry
- **401 (unauthorized):** Do NOT retry — token may be revoked. Re-pairing required
- **403 (forbidden):** Do NOT retry — device may be disabled
- **5xx (server error):** Retry with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- **Network timeout:** Retry with backoff. Do not exceed 5 retries per request

---

## 15. Token Revocation & Device Disablement

**Revoke a device:**
```
DELETE /api/v1/shops/me/devices/:deviceId
Authorization: Bearer <shopkeeper-jwt>
```
- Deletes the `PrintAgent` record (token hash gone → auth fails permanently)
- Returns queued jobs to the queue (`agentId = null`)
- Publishes `device.revoked` realtime event
- Audit-logged

**Disable a device (suspend without deletion):**
```
PATCH /api/v1/shops/me/devices/:deviceId
Authorization: Bearer <shopkeeper-jwt>
Body: { "isEnabled": false }
```
- Sets `PrintAgent.isEnabled = false`
- Device can still authenticate (token hash exists) but receives 403 on all companion routes
- Can be re-enabled with `PATCH { "isEnabled": true }`

**Token rotation (implemented):**
```
POST /api/v1/companion/token/rotate
Authorization: Bearer <current deviceToken>

Response: { "success": true, "data": { "agentId": "uuid", "deviceToken": "<new 64-hex>", "rotatedAt": "..." } }
```
- Device-token authed; rate-limited 5/60s
- Mints a fresh 64-hex token, stores its `v2:` hash in `tokenHash`, moves the previous hash to `prevTokenHash`
- **10-minute overlap:** both old and new tokens verify during the window (a crash between rotate and persist must not brick the device); the OLD token cannot advance job state past `printing` during it
- Audit-logged; publishes `device.token_rotated`
- The new raw token is returned exactly once — the companion must persist it (DPAPI) before acknowledging anything else
- `POST /api/v1/shops/me/devices/:deviceId/rotate-token` (v1.0 §15) does **not** exist and must not be implemented

---

## 15b. Paired-Device Shop Snapshot (v0.6.1)

**Endpoint:** `GET /api/v1/companion/shop-snapshot`

**Authentication:** Bearer device token

**Response (200):**
```json
{
  "success": true,
  "data": {
    "shop": { "id": "uuid", "name": "QuickPrint Demo Shop", "slug": "quickprint-demo", "timezone": "Asia/Kolkata" },
    "orders": [],
    "analytics": null
  }
}
```

- Returns the paired device's shop identity, its recent orders (for offline-tolerant UI), and shop analytics
- **Entitlement-gated:** `analytics` is `null` for free-tier shops (`analytics` entitlement); `shop` and `orders` are always returned
- Unpaired/revoked devices never reach this route (auth fails first)

## 15c. Paste-Token Path (manual pairing alternative)

Not every shopkeeper can scan a QR next to the PC. The alternative path reuses the legacy registration route and needs **no new endpoint**:

1. Shopkeeper clicks *Add device → paste token* on the dashboard → the site calls `POST /api/v1/agents/register` (JWT, owner) → a device token is minted and shown once
2. The user pastes the token into PrintEXE's pairing screen
3. PrintEXE stores it (DPAPI) and immediately validates it by calling `POST /api/v1/agents/heartbeat` — a 200 response confirms the token is live and shows the paired shop

There is no dedicated "validate" endpoint; any device-token-authed call acts as the validator. A pasted token that fails with 401 `UNAUTHORIZED` was mistyped, rotated, or revoked.

## 15d. Sync Registration (bidirectional sync opt-in)

**Endpoint:** `POST /api/v1/devices/register`

**Authentication:** Bearer JWT (owner)

**Request:** `{ "deviceId": "<PrintAgent uuid>", "deviceName": "...", "platform?": "...", "appVersion?": "...", "machineId?": "..." }`

**Response (200):** `{ deviceId, syncCursor, lastSyncAt, lastPushAt, shopId, agentName, message }`

- The `deviceId` MUST be an existing `PrintAgent` of the owner's shop (the desktop app first calls `POST /api/v1/agents/register`, which mints the device token, then this endpoint to opt into sync) — a foreign-shop device gets 404 `NOT_FOUND`
- Idempotent: re-registering returns the existing cursor
- Subsequent sync endpoints authenticate with the SAME device token. The full sync surface (all device-token authed): `POST /api/v1/sync/push`, `GET /api/v1/sync/pull?cursor=…&limit=…`, `GET /api/v1/sync/status` — all three are registered in `companion-v1.schema.json` (`routes`); their payloads are intentionally loose there (the sync queue semantics are owned by the companion's `SqliteJobQueue`)

## 16. API Versioning & Backward Compatibility

**Protocol version:** 1 (returned in pairing response as `protocolVersion: 1`)

**Backward compatibility rules:**
- Existing `/api/v1/agents/*` routes are **unchanged** — existing devices continue to work
- New `/api/v1/companion/*` routes are **additive** — only used by new PrintEXE versions
- New `/api/v1/shops/me/devices/*` routes are **additive** — only used by new website versions
- Database migrations are **additive** (IF NOT EXISTS) — safe to run on existing databases
- Device-token hashing is versioned (`v2:` prefix, §3) — legacy hashes verify until each device rotates; the pepper (`DEVICE_TOKEN_PEPPER`) changes only with a documented migration path
- Socket.IO event names are **stable** — new events are additive, existing events keep their names and payloads

**Compatibility with existing Bun CLI agent:**
The existing Bun print-agent daemon (`mini-services/print-agent/`) uses the same `/agents/*` routes and the same device-token auth. It continues to work unchanged. The new `/companion/*` routes are a parallel path for the Windows PrintEXE companion. Both can coexist.

---

## Appendix A: Existing Routes (Preserved, Unchanged)

These routes existed before the companion API and remain fully compatible:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/agents/register` | POST | JWT (owner) | Legacy device registration (mints token directly) |
| `/api/v1/agents/token` | POST | Device token | Exchange device token for Socket.IO JWT |
| `/api/v1/agents/heartbeat` | POST | Device token | Heartbeat + printer metadata |
| `/api/v1/agents/jobs/pending` | GET | Device token | Fetch queued print jobs |
| `/api/v1/agents/jobs/:id/status` | POST | Device token | Report job status (printing/completed/failed) |
| `/api/v1/agents/jobs/:id/received` | POST | Device token | Acknowledge PDF receipt + checksum |
| `/api/v1/agents/:id` | DELETE | JWT (owner) | Legacy device revocation |
| `/api/v1/shops/me/agents` | GET | JWT (owner/staff) | Legacy device list |

---

## Appendix B: Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel env | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Vercel + realtime service | HS256 signing secret for JWTs — **must be the SAME value on both** (see §11; mismatched values make every dashboard socket auth fail with `invalid or expired token`) |
| `REALTIME_EMIT_SECRET` | Vercel + realtime service | Auth for `/emit` relay endpoint |
| `DEVICE_TOKEN_PEPPER` | Vercel env | ≥16 chars; pepper for the `v2:` device-token hash (§3). Required in production; dev falls back to the legacy pepper |
| `STORAGE_PROVIDER` | Vercel env | `supabase` (production) |
| `SUPABASE_URL` | Vercel env | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env | Supabase service key |
| `SUPABASE_STORAGE_BUCKET` | Vercel env | Storage bucket name |

**Never commit these to source control. Never log their values.**

---

## Appendix C: PrintEXE Configuration

PrintEXE reads its backend settings from `appsettings.json`:
```json
{
  "PrintShop": {
    "BaseUrl": "https://printshop-saas-three.vercel.app",
    "ApiBasePath": "api/v1",
    "PollingInterval": "00:00:03",
    "HeartbeatInterval": "00:00:15",
    "SocketIoUrl": "https://printshop-saas-three.vercel.app/?XTransformPort=3003"
  }
}
```

**Token storage (canonical — matches `PrintShopCompanion.Infrastructure/Storage/DeviceTokenStore.cs`):**
- Credentials (session JWTs + device token) live at `%LocalAppData%\PrintShop\Companion\Security\device.dat`, encrypted with Windows DPAPI (`ProtectedData.Protect`, `DataProtectionScope.CurrentUser`). Never store tokens in plaintext files, registry, or configuration files.
- Writes are crash-safe: validate → serialize+encrypt → write `.tmp` in the same directory → back up the old file to `.bak` → atomic rename → round-trip verify → delete `.bak`. A failed round-trip restores the `.bak`.
- **Migration tiers (all automatic on first run):**
  1. v0.4.7 layout `%AppData%\PrintShop\Companion\device.dat` is moved to the LocalAppData Security location by `LocalStorageLayout.MigrateDeviceToken` (roaming %AppData% would separate the token from the machine-local SQLite queue/key).
  2. v0.5+ writes go to `%LocalAppData%\PrintShop\Companion\Security\device.dat` (canonical).
  3. A stale `.bak` beside the canonical file recovers a corrupted/interrupted write and is promoted back to primary.
- Device-token rotation (§15) re-uses the same save path — persist the new token BEFORE continuing other traffic; the old token stays valid server-side for 10 minutes as recovery insurance.

---

## 17. Changelog

**1.0 → 1.1 (2026-11-20, Phase 1 — verified against code, drift fixed):**
- §2/§14: error codes corrected — `TICKET_EXPIRED`/`TICKET_CONSUMED` never existed; real codes are `UNAUTHORIZED` (unknown+expired indistinguishable), `PAIRING_TICKET_UNAVAILABLE` (409), `PAIRING_TICKET_CONSUMED` (409), `ENTITLEMENT_REQUIRED` (403, `multi_device` gate documented)
- §3: device-token hashing is versioned (`v2:HMAC-SHA256(DEVICE_TOKEN_PEPPER, …)`), legacy pepper only verifies pre-existing hashes; pepper required in production; 10-minute `prevTokenHash` overlap documented
- §6: command items renamed to `{commandId, commandType, payload(object), issuedAt, expiresAt}`; GET returns `agentId`; GET flips `requested → delivered`; expired → `expired`
- §7: ack response is `{commandId, status, updatedAt}` (v1.0 wrongly said `{applied:true}`); terminal-status idempotency clarified
- §9: `failedJobs` added to the pending-jobs response; poll publishes `agent.heartbeat`
- §10: `needs_review` status + duplicate-ack `skipped` semantics documented
- §11: `auth-error` payload is `{message}` (not `{error}`)
- §12: `job.needs_review`, `device.token_rotated` events added
- §15: token rotation is IMPLEMENTED at `POST /api/v1/companion/token/rotate` (v1.0 said "future" and pointed at a non-existent dashboard route); old-token overlap window documented
- NEW §15b `GET /companion/shop-snapshot`, §15c paste-token path, §15d `POST /devices/register` sync opt-in
- Appendix B: `DEVICE_TOKEN_PEPPER` + shared `JWT_ACCESS_SECRET` warning (B-013)
- Machine-readable artifact `companion-v1.schema.json` introduced (§ header); contract tests added in both repos

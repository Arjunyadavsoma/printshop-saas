# PrintShop Companion API Contract v1

**Version:** 1.0
**Status:** Frozen
**Repository:** `Arjunyadavsoma/printshop-saas`
**Companion:** `Arjunyadavsoma/PrintEXE`

This document is the authoritative API contract between the PrintShop SaaS cloud backend and the PrintEXE Windows companion application. Agent 2 (PrintEXE) must implement against this contract exactly. Do not invent endpoints, payloads, or authentication rules not documented here.

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
| 429 | RATE_LIMITED | More than 5 per minute |

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
- Stored as `HMAC-SHA256("print-agent-salt", token)` → hex in `PrintAgent.tokenHash`
- Raw token returned exactly once — never again
- Token never expires (until revoked or rotated)

**Error responses:**
| Status | Code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | Invalid ticket format or missing deviceName |
| 401 | UNAUTHORIZED | Ticket not found (hash mismatch) |
| 401 | TICKET_EXPIRED | Ticket exists but `expiresAt < now` |
| 409 | TICKET_CONSUMED | Ticket already used (status ≠ 'active') |
| 429 | RATE_LIMITED | More than 10 per minute |

---

## 3. Device-Token Authentication

All companion API routes (except `/companion/pair`) require device authentication.

**Header:**
```http
Authorization: Bearer <deviceToken>
```

**Verification process:**
1. Extract token from `Authorization` header
2. Compute `HMAC-SHA256("print-agent-salt", token)` → hex
3. Look up `PrintAgent` where `tokenHash = <hex>`
4. If found → device is authenticated; `shopId` derived from the agent record
5. If `PrintAgent.isEnabled = false` → reject (403)
6. Update `isOnline = true`, `lastSeenAt = now` on every authenticated call

**Security rules:**
- Shop ID is ALWAYS derived from the PrintAgent record, never from client input
- A revoked device (deleted PrintAgent) cannot authenticate — hash lookup fails
- A disabled device (`isEnabled = false`) receives 403 on all companion routes
- The `print-agent-salt` is a fixed domain separator (not a secret) — it separates the HMAC namespace from other token types
- Raw tokens are never logged, never returned after initial pairing

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
    "commands": [
      {
        "id": "uuid",
        "commandType": "refresh_printers",
        "payload": "{}",
        "expiresAt": "2026-11-16T12:35:00.000Z"
      }
    ]
  }
}
```

Only commands with `status = 'requested'` and `expiresAt > now` are returned. Expired commands are automatically marked `expired`.

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
  "data": { "applied": true }
}
```

**Idempotency:** Reporting the same `commandId` with the same status is a no-op (returns `applied: true` without re-processing).

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
    "agentId": "uuid"
  }
}
```

- Returns up to 10 queued jobs (oldest first)
- `downloadUrl` is a presigned URL with 900-second (15-min) TTL
- Jobs are shop-scoped (only jobs for the device's shop)

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

**Status values:** `printing`, `completed`, `failed`

**Atomic claiming:** When `status = "printing"`, the server atomically updates `PrintJob WHERE id=? AND status='queued'`. If another device already claimed it, the response is:
```json
{
  "success": true,
  "data": { "jobId": "uuid", "skipped": true, "reason": "job is 'printing' — not in 'queued' state" }
}
```

**Completion:** When `status = "completed"`, the server:
1. Updates `PrintJob.status = 'completed'`
2. Updates `PrintFile.status = 'completed'`, `printedAt = now`
3. If all files in the order are completed → `Order.status = 'ready'`
4. Publishes `job.completed` realtime event

**Failure:** When `status = "failed"`, the server:
1. Updates `PrintJob.status = 'failed'`, `lastError = <message>`, `attempts += 1`
2. Updates `PrintFile.status = 'failed'`
3. Publishes `job.failed` realtime event

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
// Failure
socket.on('auth-error', (data) => { /* data: { error: "..." } */ });
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
| `order.paid` | `{ orderId, amountPaise }` | Payment webhook |
| `order.ready` | `{ orderId }` | Auto-triggered when all files complete |
| `agent.heartbeat` | `{ agentId }` | Heartbeat ping |
| `agent.revoked` | `{ agentId, agentName, cancelledJobs }` | Device revocation |
| `delivery.received` | `{ jobId, agentId, agentName, receivedAt, checksum }` | Receipt acknowledgment |
| `device.command.issued` | `{ commandId, agentId, commandType }` | Command creation |
| `device.revoked` | `{ agentId }` | Device revocation |

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

**Standard error codes:**
| Code | HTTP Status | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Authenticated but not authorized |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `RATE_LIMITED` | 429 | Too many requests |
| `TICKET_EXPIRED` | 401 | Pairing ticket has expired |
| `TICKET_CONSUMED` | 409 | Pairing ticket already used |
| `DEVICE_DISABLED` | 403 | Device exists but `isEnabled = false` |

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

**Token rotation (future):** Not yet implemented. When available, will use `POST /api/v1/shops/me/devices/:deviceId/rotate-token` to issue a new token and invalidate the old one.

---

## 16. API Versioning & Backward Compatibility

**Protocol version:** 1 (returned in pairing response as `protocolVersion: 1`)

**Backward compatibility rules:**
- Existing `/api/v1/agents/*` routes are **unchanged** — existing devices continue to work
- New `/api/v1/companion/*` routes are **additive** — only used by new PrintEXE versions
- New `/api/v1/shops/me/devices/*` routes are **additive** — only used by new website versions
- Database migrations are **additive** (IF NOT EXISTS) — safe to run on existing databases
- The `print-agent-salt` for HMAC is **fixed** — never changed without a migration path
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
| `JWT_ACCESS_SECRET` | Vercel + realtime service | HS256 signing secret for JWTs |
| `REALTIME_EMIT_SECRET` | Vercel + realtime service | Auth for `/emit` relay endpoint |
| `STORAGE_PROVIDER` | Vercel env | `supabase` (production) |
| `SUPABASE_URL` | Vercel env | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env | Supabase service key |
| `SUPABASE_STORAGE_BUCKET` | Vercel env | Storage bucket name |

**Never commit these to source control. Never log their values.**

---

## Appendix C: PrintEXE Configuration

PrintEXE should store its configuration in `appsettings.json`:
```json
{
  "PrintShop": {
    "BaseUrl": "https://printshop-saas-three.vercel.app",
    "PollingInterval": "00:00:03",
    "HeartbeatInterval": "00:00:15",
    "SocketIoUrl": "https://printshop-saas-three.vercel.app/?XTransformPort=3003"
  }
}
```

**Token storage:** Use Windows DPAPI (`ProtectedData.Protect`) with `DataProtectionScope.CurrentUser`. Store the encrypted token in `%AppData%\PrintEXE\device-token.dat`. Never store tokens in plaintext files, registry, or configuration files.

# PrintShop — API Contract

> The stable, versioned API contract that both the web SaaS and the
> PrintEXE Windows desktop client operate against. Every endpoint is
> documented with method, path, auth, request shape, response shape,
> and error codes.

**Status:** v1.0 — 2025-11-07. Derived from actual route implementations
in `/home/z/my-project/src/app/api/v1/`. Every endpoint listed here
exists and is callable.

**Base URL:** `https://printshop-saas-three.vercel.app` (production) or `http://localhost:3000` (dev)
**API prefix:** `/api/v1`
**Version:** v1 (no breaking changes without v2 migration)

---

## 1. Conventions

### 1.1 Envelope

Every JSON response is wrapped:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "message": "...", "code": "..." } }
```
Binary responses (PDFs, ZIPs, files) bypass the envelope.

### 1.2 Authentication

Three auth schemes, each with its own header:

| Scheme | Header | Used by | Resolves to |
|---|---|---|---|
| JWT | `Authorization: Bearer <accessToken>` | Shopkeeper web, Admin web | `Principal{userId, shopId, role}` |
| Device token | `Authorization: Bearer <deviceToken>` | Print agents, PrintEXE | `AgentPrincipal{agent, shopId}` |
| Order token | `X-Order-Token: <customerToken>` or `?t=<token>` | Customer order flow | `Order` row |

### 1.3 Error codes

| HTTP | Meaning | When |
|---|---|---|
| 200 | OK | Success |
| 201 | Created | Resource created (rare — most POSTs return 200) |
| 400 | Bad Request | Validation error |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Authenticated but not allowed (wrong role, wrong tenant) |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate (email, slug, paymentTxnId) |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Error | Unhandled (logged with requestId) |

### 1.4 Pagination

List endpoints accept `?limit=20&offset=0` and return:
```json
{ "data": { "items": [...], "pagination": { "limit": 20, "offset": 0, "total": 142, "hasNext": true } } }
```

### 1.5 Rate limiting

Public endpoints use fixed-window rate limiting (per-IP). Authenticated endpoints are not rate-limited (except login/register).

---

## 2. Auth domain

### POST /api/v1/auth/login
Rate-limited (20/min). Returns access + refresh tokens.
```json
// Request
{ "email": "owner@shop.com", "password": "secret" }
// Response 200
{ "accessToken": "...", "refreshToken": "...", "expiresIn": 900,
  "user": { "id": "...", "email": "...", "role": "owner", "shopId": "..." } }
```
Admin login uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` env (constant-time compare).

### POST /api/v1/auth/register
Rate-limited (5/min). Creates User + Shop in one transaction.
```json
// Request
{ "email", "password", "phone", "name", "shopName", "slug",
  "description?", "upiId", "address", "services",
  "paymentMethods"?: "upi|cash|both|split",
  "pamphletEnabled"?: false, "pamphletPricePaise"?: 0, "pamphletName"?: "" }
// Response 200
{ "accessToken", "refreshToken", "expiresIn", "user": {...}, "shop": {"id","name","slug"} }
```
409 on duplicate email or slug.

### GET /api/v1/auth/register?slug=foo
Rate-limited (30/min). Slug availability probe.
```json
{ "available": true, "slug": "foo" }
```

### POST /api/v1/auth/refresh
No auth. Rotates refresh token (replay-guarded by jti).
```json
// Request
{ "refreshToken": "..." }
// Response 200
{ "accessToken": "...", "refreshToken": "..." }
```

### GET /api/v1/me
JWT auth. Returns current principal.
```json
{ "id", "email", "phone", "role", "shopId" }
```

---

## 3. Shops domain

### GET /api/v1/shops?q=&limit=&offset=
Public, rate-limited (60/min). Active shops directory.
```json
{ "shops": [{ "id","name","slug","address","phone","upiId",
  "paymentProvider","subscriptionTier","isActive","pricingSummary" }],
  "pagination": {...} }
```

### GET /api/v1/shops/{slug}
Public, rate-limited (60/min). Shop info + pricing.
```json
{ "id","name","slug","upiId","paymentProvider","pricingConfig",
  "timezone","privacy": {...} }
```

### POST /api/v1/shops/{slug}/orders
Public, rate-limited (20/min). Create draft order.
```json
// Request
{ "customerPhone"?: "...", "notes"?: "..." }
// Response 200
{ "orderId": "...", "customerToken": "B5EY7Y", "tokenNumber": "A104",
  "status": "awaiting_payment", "shop": {"name","slug"} }
```

### GET /api/v1/shops/me
JWT auth. Owner's shop profile (no credentials).

### PATCH /api/v1/shops/me
JWT auth. Update shop settings.

### GET /api/v1/shops/me/qr?format=png|svg&download=bool
JWT auth. Shop ordering QR.

### POST /api/v1/shops/me/upi-qr
JWT auth. Upload UPI QR image (multipart, ≤5MB).

### GET /api/v1/shops/me/sticker
JWT auth. PDF sticker sheet (6 stickers, A4).

### GET /api/v1/shops/me/agents
JWT auth. List registered print agents.

### GET /api/v1/shops/me/analytics
JWT auth. Revenue + status mix + file-setting aggregates.

### GET /api/v1/shops/me/reports/daily?date=YYYY-MM-DD
JWT auth (owner). Daily reconciliation report.

### GET /api/v1/shops/me/payment-credentials
JWT auth (owner), rate-limited. Payment provider status (masked).

### PUT /api/v1/shops/me/payment-credentials
JWT auth (owner), rate-limited. Save encrypted credentials.

### DELETE /api/v1/shops/me/payment-credentials?provider=phonepe|paytm
JWT auth (owner), rate-limited. Disconnect a provider.

### POST /api/v1/shops/me/payment-credentials/activate
JWT auth (owner), rate-limited. Activate a saved provider.
```json
{ "provider": "phonepe" }
```

---

## 4. Orders domain (customer-facing — order token auth)

All require `X-Order-Token` header or `?t=` query matching `order.customerToken`.

### POST /api/v1/orders/{id}/checkout
Rate-limited (20/min). Create payment intent.
```json
// Response 200
{ "orderId","merchantOrderId","amountPaise","currency",
  "provider","checkoutUrl"?, "upiUri"?, "qrPayload"?, "expiresAt" }
```

### POST /api/v1/orders/{id}/files/upload-url
Rate-limited (30/min). Mint presigned PUT URL (5-min expiry).
```json
// Request
{ "filename": "doc.pdf", "mimeType": "application/pdf", "size": 1048576 }
// Response 200
{ "fileId": "...", "storageKey": "...", "uploadUrl": "...", "expiresInSeconds": 300 }
```

### POST /api/v1/orders/{id}/files
Rate-limited (30/min). Confirm upload + parse page count.
```json
// Request
{ "fileId": "...", "storageKey": "...", "filename": "...", "mimeType": "...", "size": ... }
// Response 200
{ "fileId": "...", "pageCount": 5, "status": "pending", "needsReview": false }
```

### PATCH /api/v1/orders/{id}/files/{fileId}
Rate-limited (60/min). Update print settings + re-price.
```json
// Request
{ "copies"?: 2, "colorMode"?: "color", "pageRange"?: "1-5",
  "paperSize"?: "a4", "duplex"?: true }
// Response 200
{ "file": {...}, "orderTotalPaise": 5000, "lineItems": [...] }
```

### GET /api/v1/orders/{id}/status
Rate-limited (120/min). Poll payment + print status.
```json
{ "orderId","customerToken","tokenNumber","status",
  "totalAmountPaise","totalFormatted","currency","paidAt",
  "paymentTxnId","paymentUtr",
  "files": [{"id","filename","status","copies","colorMode","duplex","printedAt"}],
  "updatedAt" }
```

### GET /api/v1/orders/{id}/receipt
Binary PDF. Only for paid orders.

---

## 5. Orders domain (shopkeeper-facing — JWT auth)

### GET /api/v1/shops/me/orders?status=&limit=&offset=
JWT auth. Paginated, filterable order list.

### GET /api/v1/shops/me/orders/{id}
JWT auth. Order detail incl. files.

### PATCH /api/v1/shops/me/orders/{id}
JWT auth. Update shopkeeper notes.
```json
{ "notes": "Customer requested rush" }
```

### POST /api/v1/shops/me/orders/{id}/start
JWT auth. Manual start (paid → printing).

### POST /api/v1/shops/me/orders/{id}/print
JWT auth. Dispatch all pending files to agent.

### POST /api/v1/shops/me/orders/{id}/ready
JWT auth. Mark ready for pickup (printing → ready).

### POST /api/v1/shops/me/orders/{id}/complete
JWT auth. Mark collected + delete files from storage.

### POST /api/v1/shops/me/orders/{id}/cancel
JWT auth. Cancel order.
```json
{ "reason"?: "Customer cancelled" }
```

### POST /api/v1/shops/me/orders/{id}/verify-payment
JWT auth (owner). Manual payment verification.
```json
{ "action": "verify"|"reject", "txnReference"?: "...", "note"?: "..." }
```

### GET /api/v1/shops/me/orders/{id}/activity
JWT auth. Activity timeline from audit log.

### GET /api/v1/shops/me/orders/{id}/files/{fileId}/download
JWT auth. Secure file download (binary).

### GET /api/v1/shops/me/orders/{id}/files/{fileId}/print-url
JWT auth (owner). Short-lived (60s) presigned URL for printer.

---

## 6. Agents domain (device token auth — for PrintEXE + print agents)

**This is the domain PrintEXE must use.** All require `Authorization: Bearer <deviceToken>`.

### POST /api/v1/agents/register
JWT auth (owner). Mint device token for a new agent.
```json
// Request
{ "name": "Front Desk PC", "os"?: "win32", "version"?: "1.0.0", "printerName"?: "HP LaserJet" }
// Response 200
{ "agentId": "...", "deviceToken": "...", "shopId": "...", "shopName": "...",
  "warning": "Save this token — it is shown only once." }
```
**⚠️ PrintEXE currently expects a `/pair` endpoint with a magic-link ticket. This route requires the owner's JWT instead. PrintEXE must adapt.**

### POST /api/v1/agents/token
Device auth. Exchange long-lived device token for short-lived JWT (for socket.io auth).
```json
// Response 200
{ "accessToken": "...", "expiresIn": 900, "shopId": "..." }
```
**⚠️ PrintEXE does not currently call this. It must, before connecting to socket.io.**

### POST /api/v1/agents/heartbeat
Device auth. Refresh presence.
```json
// Request
{ "printerName"?: "...", "version"?: "...", "os"?: "..." }
// Response 200
{ "agentId": "...", "online": true, "ts": "..." }
```

### GET /api/v1/agents/jobs/pending
Device auth. Fetch queued jobs (up to 10).
```json
{ "jobs": [{ "jobId","fileId","orderId","filename","downloadUrl",
  "copies","colorMode","duplex","paperSize","pageRange" }], "agentId": "..." }
```

### POST /api/v1/agents/jobs/{jobId}/status
Device auth. Atomic claim / completion / failure report.
```json
// Request
{ "status": "printing"|"completed"|"failed", "lastError"?: "...", "printerName"?: "..." }
// Response 200
{ "jobId": "...", "status": "...", "applied": true }
// OR (idempotent skip)
{ "jobId": "...", "skipped": true, "reason": "already completed" }
```
**⚠️ PrintEXE currently sends `{printedAt, failedAt, errorMessage}`. It must send `{status, lastError, printerName}` instead.**

**⚠️ PrintEXE expects a separate `/jobs/{jobId}/ack` endpoint. This doesn't exist — the status report `status:"printing"` IS the atomic claim. PrintEXE must drop the ack call.**

---

## 7. Payments domain

### POST /api/v1/payments/phonepe/webhook
No auth (signature-verified inside). PhonePe v1 (X-VERIFY) + v2 (SHA auth) auto-detect.

### POST /api/v1/payments/paytm/callback
No auth (CHECKSUMHASH verified). Renders HTML page back to customer.

### GET /api/v1/payments/upi/verify/{orderId}
Public, rate-limited (60/min). UPI deep-link status check.

### POST /api/v1/payments/dev/phonepe/simulate
DEV ONLY. Signs real PhonePe webhook + feeds through processWebhook.

### POST /api/v1/payments/dev/paytm/simulate
DEV ONLY. Signs real Paytm callback.

---

## 8. Admin domain (JWT auth, role: admin)

### GET /api/v1/admin/access-check?key=
Public (constant-time key compare). Defense-in-depth for admin login page.

### GET /api/v1/admin/orders?status=&shopId=&limit=&offset=
Admin. Cross-shop order list.

### GET /api/v1/admin/orders/{id}
Admin. Full order detail + files + print jobs.

### GET /api/v1/admin/shops?limit=&offset=
Admin. All shops with aggregates.

### GET /api/v1/admin/shops/{id}
Admin. Shop detail + orders + agents.

### GET /api/v1/admin/analytics?date=
Admin. Platform-wide metrics.

### GET /api/v1/admin/audit?limit=
Admin. Recent audit log entries.

### GET /api/v1/admin/metrics
Admin. Throughput + payments + revenue + printing + agents.

---

## 9. Storage / downloads domain

### GET /api/v1/downloads/native-printer
Public. ZIP of the Native Windows Printer service.

### PUT /api/v1/storage/put?key=&exp=&sig=&ct=
DEV ONLY. In-memory storage upload receiver.

### GET /api/v1/storage/get?key=&exp=&sig=
DEV ONLY. In-memory storage download.

---

## 10. Sync domain (⚠️ NOT YET IMPLEMENTED — Phase 5)

These endpoints do not exist yet. They are the target contract for bidirectional sync.

### POST /api/v1/devices/register
JWT auth (owner). Register a desktop device with sync cursor.
```json
// Request
{ "deviceId": "uuid", "deviceName": "Front Desk PC", "platform": "win32",
  "appVersion": "1.0.0", "machineId": "..." }
// Response 200
{ "deviceId": "...", "syncCursor": "2025-11-07T10:00:00Z", "token": "..." }
```

### GET /api/v1/sync/pull?cursor=&limit=
Device auth. Incremental pull of changes since cursor.
```json
{ "changes": [{ "entity": "Order", "id": "...", "action": "upsert"|"delete",
  "data": {...}, "revision": 42, "updatedAt": "..." }],
  "nextCursor": "2025-11-07T10:01:00Z", "hasMore": false }
```

### POST /api/v1/sync/push
Device auth. Submit client-side changes.
```json
// Request
{ "changes": [{ "entity": "Order", "id": "...", "action": "upsert",
  "data": {...}, "clientRevision": 41, "baseRevision": 40 }] }
// Response 200
{ "results": [{ "id": "...", "accepted": true, "serverRevision": 42,
  "conflict"?: false, "serverData"?: {...} }] }
```

### GET /api/v1/sync/status
Device auth. Sync state + pending changes.
```json
{ "deviceId": "...", "lastSyncAt": "...", "serverRevision": 12345,
  "pendingPushes": 0, "pendingPulls": 12 }
```

---

## 11. Health / system domain

### GET /api/v1/health
Public. Liveness probe (always 200).

### GET /api/v1/ready
Public, rate-limited (30/min). Readiness probe (pings DB).

### POST /api/v1/setup-database?key=
One-time DB initialization (raw SQL).

---

## 12. PrintEXE adaptation requirements

PrintEXE's `HttpPrintShopBackend.cs` must be rewritten to use this contract:

| PrintEXE current | SaaS contract | Action |
|---|---|---|
| `X-PrintShop-Device-Token` header | `Authorization: Bearer <token>` | Change header |
| `POST /pair` (magic-link) | `POST /api/v1/agents/register` (owner JWT) | Either: (a) owner pairs via web UI, copies token to desktop, or (b) add a real `/api/v1/agents/pairing/begin` route |
| `POST /jobs/{jobId}/ack` | (doesn't exist) | Remove the ack call |
| `POST /jobs/{jobId}/status` with `{printedAt,failedAt,errorMessage}` | `POST /api/v1/agents/jobs/{jobId}/status` with `{status,lastError,printerName}` | Change DTO |
| `POST /device/revoke` | (doesn't exist) | Add `DELETE /api/v1/agents/{agentId}` route (owner auth) |
| Socket.IO `DeliverJob`/`AckJob`/`ReportStatus` on `/companion-hub` | `job.dispatch`/`auth`/`auth-ok` on `/` (port 3003) | Rewrite `SocketIoRealtimeClient.cs` |
| No token→JWT exchange | `POST /api/v1/agents/token` before socket connect | Add this call |

See `docs/DESKTOP_INTEGRATION.md` for the full migration path.

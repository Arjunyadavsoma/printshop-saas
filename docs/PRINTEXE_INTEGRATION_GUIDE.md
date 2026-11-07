# PrintEXE Integration Guide — Complete Technical Reference

> Everything you need to build the PrintEXE Windows desktop client
> against the PrintShop SaaS backend. Every endpoint, every header,
> every DTO, every event — copied from the actual source code.

**Last updated:** 2025-11-07
**Backend repo:** `github.com/Arjunyadvsoma/printshop-saas`
**Production URL:** `https://printshop-saas-three.vercel.app`
**API base:** `https://printshop-saas-three.vercel.app/api/v1`
**Commit:** `7de6be3` (or later)

---

## 1. Production Environment

### 1.1 URLs

| Service | URL | Purpose |
|---|---|---|
| Web app | `https://printshop-saas-three.vercel.app` | Customer + shopkeeper + admin UI |
| API | `https://printshop-saas-three.vercel.app/api/v1` | REST API |
| Socket.IO | `https://printshop-saas-three.vercel.app/?XTransformPort=3003` | Realtime (via Caddy gateway) |
| Health | `GET /api/v1/health` | Liveness probe |
| Readiness | `GET /api/v1/ready` | DB + storage + cache check |

### 1.2 Environment variables (backend — for reference)

These are set on Vercel. You don't need them in PrintEXE, but they tell you what the backend expects:

```
DATABASE_URL=postgresql://postgres.duyharicyurufmsjyhgs:***@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true
SUPABASE_URL=https://duyharicyurufmsjyhgs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_***
SUPABASE_STORAGE_BUCKET=printshop-uploads
JWT_ACCESS_SECRET=<64-hex-chars>
JWT_REFRESH_SECRET=<64-hex-chars>
PAYMENT_ENCRYPTION_KEY=<44-base64-chars>
PHONEPE_WEBHOOK_USERNAME=<configured>
PHONEPE_WEBHOOK_PASSWORD=<configured>
REALTIME_EMIT_SECRET=<64-hex-chars>
APP_BASE_URL=https://printshop-saas-three.vercel.app
```

### 1.3 PrintEXE configuration (what you need)

In your `appsettings.json`:
```json
{
  "Backend": {
    "BaseUrl": "https://printshop-saas-three.vercel.app",
    "ApiBasePath": "/api/v1",
    "SocketIoPath": "/?XTransformPort=3003",
    "HeartbeatInterval": "00:01:00",
    "PollInterval": "00:00:02"
  }
}
```

### 1.4 Database tables (production — verified)

```
AuditLog, Order, PaymentAttempt, PaymentEvent, PrintAgent, PrintFile,
PrintJob, Shop, Subscription, User
```
(10 tables, 1 shop, 1 user as of 2025-11-07)

---

## 2. Authentication — THE MOST IMPORTANT SECTION

PrintEXE uses **device token auth** (not JWT). Here's the exact flow:

### 2.1 The pairing flow (how PrintEXE gets a device token)

**Step 1: Shopkeeper logs into the web dashboard**

The shopkeeper goes to `https://printshop-saas-three.vercel.app/shop/login`, enters their email + password. The web app calls:

```
POST /api/v1/auth/login
Content-Type: application/json

{"email": "owner@shop.com", "password": "their-password"}
```

Response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "expiresIn": 900,
    "user": {"id": "...", "email": "...", "role": "owner", "shopId": "..."}
  }
}
```

**Step 2: Shopkeeper registers PrintEXE as a print agent**

The shopkeeper goes to the "Printer Setup" page in the web dashboard and clicks "Register new agent." The web app calls:

```
POST /api/v1/agents/register
Authorization: Bearer <accessToken>
Content-Type: application/json

{"name": "Front Desk PC", "os": "win32", "version": "1.0.0", "printerName": "HP LaserJet"}
```

Response (the device token is returned ONCE):
```json
{
  "success": true,
  "data": {
    "agentId": "550e8400-e29b-41d4-a716-446655440000",
    "deviceToken": "550e8400-e29b-41d4-a716-446655440000-another-uuid",
    "shopId": "...",
    "shopName": "Arjun Print Hub",
    "warning": "Save this token — it is shown only once."
  }
}
```

**Step 3: Shopkeeper pastes the device token into PrintEXE**

PrintEXE shows a "Paste your device token" field. The shopkeeper pastes the `deviceToken`. PrintEXE stores it (DPAPI-encrypted) and uses it for ALL subsequent API calls.

### 2.2 How device token auth works (server-side)

Every PrintEXE API call sends:
```
Authorization: Bearer <deviceToken>
```

The server:
1. Extracts the token after `Bearer `
2. Hashes it: `HMAC-SHA256('print-agent-salt', token)` → hex string
3. Looks up `PrintAgent` by `tokenHash` in the database
4. If found → resolves `shopId` from the agent row (tenant isolation)
5. Refreshes `isOnline=true`, `lastSeenAt=now`
6. Passes `{agent, shopId}` to the route handler

**The salt is the literal string `"print-agent-salt"`.** This is NOT a secret — it's a domain separator. The security comes from the token being a 72-char UUID pair that's impossible to guess.

### 2.3 Token → JWT exchange (for Socket.IO)

Before connecting to Socket.IO, PrintEXE must exchange the device token for a JWT:

```
POST /api/v1/agents/token
Authorization: Bearer <deviceToken>
```

Response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbG...",
    "expiresIn": 900,
    "shopId": "..."
  }
}
```

This JWT is HS256-signed with `JWT_ACCESS_SECRET` (server-side). PrintEXE uses it ONLY for Socket.IO auth — never for REST calls (REST calls use the device token directly).

### 2.4 JWT format (for Socket.IO verification)

The JWT is:
- Algorithm: HS256
- Header: `{"alg":"HS256","typ":"JWT"}`
- Payload: `{"sub":"agent:<agentId>","shopId":"<shopId>","role":"staff","type":"access","iat":<epoch>,"exp":<epoch+900>}`
- TTL: 15 minutes (900 seconds)

PrintEXE does NOT need to verify the JWT — the Socket.IO server does that. PrintEXE just sends it.

---

## 3. API Endpoints — Exact DTOs

### 3.1 PrintEXE endpoints (device token auth)

All require `Authorization: Bearer <deviceToken>`.

#### POST /api/v1/agents/register
**Auth:** JWT (owner) — called from the web dashboard, NOT from PrintEXE directly.

Request:
```json
{"name": "Front Desk PC", "os": "win32", "version": "1.0.0", "printerName": "HP LaserJet"}
```
Response 200:
```json
{"agentId": "...", "deviceToken": "...", "shopId": "...", "shopName": "...", "warning": "Save this token — it is shown only once."}
```

#### POST /api/v1/agents/token
**Auth:** Device token. Exchange device token → JWT for Socket.IO.

Request: (empty body)
Response 200:
```json
{"accessToken": "eyJhbG...", "expiresIn": 900, "shopId": "..."}
```

#### POST /api/v1/agents/heartbeat
**Auth:** Device token. Refresh presence.

Request:
```json
{"printerName": "HP LaserJet", "version": "1.0.0", "os": "win32"}
```
(All fields optional — send whatever you have)

Response 200:
```json
{"agentId": "...", "online": true, "ts": "2025-11-07T10:00:00.000Z"}
```

#### GET /api/v1/agents/jobs/pending
**Auth:** Device token. Fetch queued print jobs (up to 10).

Response 200:
```json
{
  "jobs": [
    {
      "jobId": "uuid",
      "fileId": "uuid",
      "orderId": "uuid",
      "filename": "document.pdf",
      "downloadUrl": "https://...presigned... (900-second TTL)",
      "copies": 2,
      "colorMode": "bw",
      "duplex": false,
      "paperSize": "a4",
      "pageRange": null
    }
  ],
  "agentId": "..."
}
```

**The `downloadUrl` is a presigned S3/R2/Supabase URL** (15-minute TTL). PrintEXE downloads the PDF from this URL directly (not through the API).

#### POST /api/v1/agents/jobs/{jobId}/status
**Auth:** Device token. Report job status — this is how you CLAIM and COMPLETE jobs.

Request:
```json
{"status": "printing", "printerName": "HP LaserJet"}
```

The `status` field is an enum: `"printing"` | `"completed"` | `"failed"`.

**CLAIMING a job:** Send `{status: "printing"}`. This is an atomic conditional update (`UPDATE WHERE id=? AND status='queued'`). If another agent already claimed it, you get:
```json
{"jobId": "...", "skipped": true, "reason": "job is 'printing' — already claimed by another agent"}
```

**COMPLETING a job:** Send `{status: "completed"}`. Idempotent — if already completed:
```json
{"jobId": "...", "skipped": true, "reason": "job is 'completed' — not in 'printing' state (duplicate ack or already completed)"}
```

**FAILING a job:** Send `{status: "failed", "lastError: "Paper jam"}`.

Response 200 (success):
```json
{"jobId": "...", "status": "printing", "applied": true}
```

#### DELETE /api/v1/agents/{id}
**Auth:** JWT (owner) — called from the web dashboard to revoke a PrintEXE device.

Response 200:
```json
{"agentId": "...", "agentName": "Front Desk PC", "revoked": true, "cancelledJobs": 0, "message": "Agent \"Front Desk PC\" revoked. 0 queued job(s) returned to the queue."}
```

### 3.2 Sync endpoints (device token auth)

#### GET /api/v1/sync/pull?cursor={ISO8601}&limit=100
**Auth:** Device token. Incremental pull of changes since cursor.

Response 200:
```json
{
  "changes": [
    {
      "entity": "Order",
      "id": "uuid",
      "action": "upsert",
      "data": {"id": "...", "shopId": "...", "status": "paid", "totalAmountPaise": 5000, ...},
      "revision": 1,
      "updatedAt": "2025-11-07T10:01:00.000Z"
    }
  ],
  "nextCursor": "2025-11-07T10:01:00.000Z",
  "hasMore": false
}
```

**Initial cursor:** `1970-01-01T00:00:00Z` (pulls everything on first sync).

**Entities pulled:** Order, PrintFile, PrintJob, Shop, PrintAgent, Customer (if table exists).

#### POST /api/v1/sync/push
**Auth:** Device token. Submit client-side changes.

Request:
```json
{
  "changes": [
    {
      "entity": "Customer",
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "action": "upsert",
      "data": {"name": "John Doe", "phone": "9876543210"},
      "clientRevision": 1,
      "baseRevision": 0
    }
  ]
}
```

Response 200:
```json
{
  "results": [
    {"id": "...", "accepted": true, "serverRevision": 1, "conflict": false}
  ]
}
```

**Only Customer is pushable in v1.** Orders, PrintJobs, etc. are server-authoritative — use the dedicated API endpoints.

#### GET /api/v1/sync/status
**Auth:** Device token.

Response 200:
```json
{"deviceId": "...", "shopId": "...", "syncCursor": "2025-11-07T10:00:00Z", "lastSyncAt": "...", "agentName": "...", "isOnline": true}
```

### 3.3 Shopkeeper endpoints (JWT auth — for reference)

PrintEXE does NOT call these directly (the web dashboard does). But PrintEXE might display the data fetched via sync. For reference:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/shops/me` | Shop profile |
| PATCH | `/api/v1/shops/me` | Update settings |
| GET | `/api/v1/shops/me/orders?status=&limit=&offset=` | Order list |
| GET | `/api/v1/shops/me/orders/{id}` | Order detail |
| POST | `/api/v1/shops/me/orders/{id}/start` | Start printing |
| POST | `/api/v1/shops/me/orders/{id}/ready` | Mark ready |
| POST | `/api/v1/shops/me/orders/{id}/complete` | Mark collected |
| POST | `/api/v1/shops/me/orders/{id}/cancel` | Cancel order |
| POST | `/api/v1/shops/me/orders/{id}/verify-payment` | Manual payment verify |
| GET | `/api/v1/shops/me/analytics` | Revenue + stats |
| GET | `/api/v1/shops/me/reports/daily?date=YYYY-MM-DD` | Daily report |
| GET | `/api/v1/shops/me/agents` | List agents |
| GET | `/api/v1/shops/me/orders/{id}/files/{fileId}/print-url` | 60s presigned URL |

---

## 4. Socket.IO Realtime — Exact Protocol

### 4.1 Connection URL

```
wss://printshop-saas-three.vercel.app/?XTransformPort=3003
```

**IMPORTANT:** The `XTransformPort=3003` query parameter is REQUIRED. The Caddy gateway at port 443 routes requests with this query to the Socket.IO mini-service on port 3003. Without it, you hit the Next.js app (port 3000) which doesn't serve Socket.IO.

### 4.2 Connection options (C# SocketIOClient)

```csharp
var client = new SocketIOClient.SocketIO(
    "https://printshop-saas-three.vercel.app/?XTransformPort=3003",
    new SocketIOClient.SocketIOOptions
    {
        Path = "/",
        Transports = new List<string> { "websocket", "polling" },
        Reconnection = true,
        ReconnectionAttempts = int.MaxValue,
        ReconnectionDelay = 2000,
        Timeout = TimeSpan.FromSeconds(8000)
    }
);
```

### 4.3 Auth handshake

After connecting, PrintEXE must emit an `auth` event with the JWT (from `POST /api/v1/agents/token`):

```csharp
client.On("connect", async () =>
{
    var jwt = await ExchangeDeviceTokenForJwt(deviceToken);
    await client.EmitAsync("auth", new { token = jwt });
});
```

The server responds:
- `auth-ok` → `{shopId: "...", role: "staff"}` → you're joined to room `shop:<shopId>`
- `auth-error` → `{message: "invalid or expired token"}` → you're disconnected

```csharp
client.On("auth-ok", response => { /* start listening */ });
client.On("auth-error", response => { /* reconnect after refreshing JWT */ });
```

### 4.4 Events to listen for

| Event | Payload | What to do |
|---|---|---|
| `job.dispatch` | `{jobId, fileId, orderId, filename, downloadUrl, copies, colorMode, duplex, paperSize, pageRange}` | Download the PDF from `downloadUrl`, print it, report status |
| `order.paid` | `{orderId, amountPaise}` | Refresh dashboard (optional) |
| `order.ready` | `{orderId}` | Refresh dashboard (optional) |
| `job.printing` | `{jobId, fileId}` | Another agent started printing (optional) |
| `job.completed` | `{jobId, fileId}` | Another agent completed (optional) |
| `agent.revoked` | `{agentId, agentName}` | If it's YOUR agentId → your token was revoked → show "Device revoked" + stop |
| `sync.pushed` | `{count}` | New data available → trigger a sync pull |

### 4.5 Events PrintEXE should NOT emit

PrintEXE does NOT emit `AckJob`, `ReportStatus`, `Heartbeat`, `DeliverJob`, or any custom events. All communication is via REST:
- Heartbeat → `POST /api/v1/agents/heartbeat`
- Job status → `POST /api/v1/agents/jobs/{id}/status`
- Sync → `GET /api/v1/sync/pull` + `POST /api/v1/sync/push`

Socket.IO is **receive-only** for PrintEXE (except the initial `auth` emit).

---

## 5. The Print Job Lifecycle

```
1. Customer pays → webhook verifies → order.status = 'paid'
2. Server creates PrintJob rows (status='queued') for each file
3. Server publishes 'job.dispatch' via Socket.IO → PrintEXE receives
4. PrintEXE downloads PDF from downloadUrl (presigned, 15-min TTL)
5. PrintEXE POSTs /agents/jobs/{id}/status {status:'printing'} → ATOMIC CLAIM
   - If skipped (another agent claimed) → ignore, move to next job
6. PrintEXE prints the PDF (SumatraPDF / Windows spooler)
7. PrintEXE POSTs /agents/jobs/{id}/status {status:'completed'}
   - OR {status:'failed', lastError:'paper jam'}
8. Server marks file as completed/failed
9. When ALL files in an order are completed → server marks order.status='ready'
10. Shopkeeper marks order 'collected' → files deleted from storage
```

### 5.1 Polling fallback

If Socket.IO is disconnected, PrintEXE polls:
```
GET /api/v1/agents/jobs/pending
```
every 2 seconds. This returns up to 10 queued jobs. PrintEXE claims the first one it can.

### 5.2 Heartbeat

PrintEXE sends a heartbeat every 60 seconds:
```
POST /api/v1/agents/heartbeat
{"printerName": "HP LaserJet", "version": "1.0.0", "os": "win32"}
```

If no heartbeat for 30+ seconds, the dashboard shows the agent as offline.

---

## 6. File Download

### 6.1 Presigned URLs

The `downloadUrl` from `GET /agents/jobs/pending` or `job.dispatch` event is a presigned S3/R2/Supabase URL:
- **TTL:** 15 minutes (900 seconds) for job pending, 60 seconds for shopkeeper print-url
- **Direct download:** PrintEXE downloads directly from the URL (not through the API)
- **No auth needed:** the URL itself contains the signature

### 6.2 C# download example

```csharp
using var httpClient = new HttpClient();
httpClient.Timeout = TimeSpan.FromMinutes(5);
var response = await httpClient.GetAsync(job.downloadUrl);
response.EnsureSuccessStatusCode();
var pdfBytes = await response.Content.ReadAsByteArrayAsync();
// Save to temp file + print
var tempPath = Path.Combine(Path.GetTempPath(), $"printshop-{job.jobId}.pdf");
await File.WriteAllBytesAsync(tempPath, pdfBytes);
```

### 6.3 SHA-256 verification (recommended)

Verify the downloaded PDF integrity:
```csharp
using var sha256 = System.Security.Cryptography.SHA256.Create();
var hash = Convert.ToHexString(await sha256.ComputeHashAsync(fileStream));
// Compare against expected hash if available
```

---

## 7. Database Schema (for reference)

PrintEXE does NOT connect to the database directly. But understanding the schema helps you model your local cache.

### 7.1 Key models

**Shop** (the tenant):
```
id, name, slug, upiId, paymentProvider, pricingConfig (JSON), address, phone,
timezone, isActive, subscriptionTier, subscriptionExpiresAt,
paymentMethods ('upi'|'cash'|'both'|'split'),
pamphletEnabled, pamphletPricePaise, pamphletName
createdAt, updatedAt
```

**Order**:
```
id, shopId, customerToken (6-char), status, totalAmountPaise, currency,
paymentProvider, paymentTxnId, paymentUtr, paidAt, customerPhone, notes,
tokenNumber (per-shop sequential, e.g. "A104")
createdAt, updatedAt
```

**Order status values:** `awaiting_payment` → `paid` → `printing` → `ready` → `collected` (or `cancelled`, `refunded`)

**PrintFile**:
```
id, orderId, originalFilename, storageKey, mimeType, sizeBytes, pageCount,
copies, colorMode ('bw'|'color'), pageRange, paperSize ('a4'|'a3'|'letter'|'legal'),
duplex, pricePaise, status, printedAt
createdAt, updatedAt
```

**PrintFile status:** `pending` → `queued` → `printing` → `completed` (or `failed`, `needs_review`)

**PrintJob**:
```
id, shopId, fileId, agentId, status, attempts, lastError,
queuedAt, startedAt, completedAt
createdAt, updatedAt
```

**PrintJob status:** `queued` → `printing` → `completed` (or `failed`, `needs_review`)

**PrintAgent** (this is PrintEXE's identity):
```
id, shopId, name, tokenHash, lastSeenAt, printerName, isOnline, version, os
createdAt, updatedAt
```

### 7.2 Money

All amounts are **integer paise** (1 INR = 100 paise). Display format:
```
formatINRFromPaise(5000) → "₹50.00"
```
In C#: `₹{(amountPaise / 100m):0.00}"`

### 7.3 Pricing config (JSON in Shop.pricingConfig)

```json
{
  "bwA4PerPage": 200,
  "colorA4PerPage": 600,
  "bwA3PerPage": 400,
  "colorA3PerPage": 2000,
  "minOrderValue": 500,
  "duplexDiscountPercent": 10
}
```

All values in paise. PrintEXE should NOT compute prices — always display the server-computed `totalAmountPaise`.

---

## 8. Response Envelope

Every JSON response is wrapped:

```json
// Success
{"success": true, "data": {...}}

// Error
{"success": false, "error": {"code": "INTERNAL_ERROR", "message": "..."}}
```

**Binary responses** (PDFs, ZIPs, files) bypass the envelope — they're raw bytes with the appropriate Content-Type.

### Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | Invalid request body |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Wrong role or tenant |
| 404 | NOT_FOUND | Resource doesn't exist |
| 409 | CONFLICT | Duplicate (email, slug, paymentTxnId) |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Unhandled (logged with requestId) |

---

## 9. PrintEXE Configuration (recommended)

### 9.1 appsettings.json

```json
{
  "Backend": {
    "BaseUrl": "https://printshop-saas-three.vercel.app",
    "ApiBasePath": "/api/v1",
    "SocketIoUrl": "https://printshop-saas-three.vercel.app/?XTransformPort=3003",
    "HeartbeatIntervalSeconds": 60,
    "PollIntervalSeconds": 2,
    "DownloadTimeoutSeconds": 300,
    "MaxPrintAttempts": 5
  },
  "Storage": {
    "DeviceTokenPath": "%AppData%/PrintShop/Companion/device.dat",
    "QueueDbPath": "%AppData%/PrintShop/Companion/queue.db",
    "PdfCacheDir": "%Temp%/PrintShop/Companion/pdfs",
    "LogDir": "%AppData%/PrintShop/Companion/logs"
  }
}
```

### 9.2 HTTP client setup (C#)

```csharp
public class PrintShopBackend
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _deviceToken;

    public PrintShopBackend(string baseUrl, string deviceToken)
    {
        _baseUrl = baseUrl.TrimEnd('/') + "/api/v1";
        _deviceToken = deviceToken;
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", deviceToken);
    }

    // GET /agents/jobs/pending
    public async Task<PendingJobsResponse> GetPendingJobs()
    {
        var res = await _http.GetAsync($"{_baseUrl}/agents/jobs/pending");
        var json = await res.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<PendingJobsResponse>(json);
    }

    // POST /agents/jobs/{id}/status
    public async Task<StatusResponse> ReportJobStatus(
        string jobId, string status, string lastError = null)
    {
        var body = JsonSerializer.Serialize(new { status, lastError });
        var res = await _http.PostAsync(
            $"{_baseUrl}/agents/jobs/{jobId}/status",
            new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await res.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<StatusResponse>(json);
    }

    // POST /agents/token (exchange device token → JWT for Socket.IO)
    public async Task<TokenResponse> ExchangeForJwt()
    {
        var res = await _http.PostAsync($"{_baseUrl}/agents/token", null);
        var json = await res.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<TokenResponse>(json);
    }

    // POST /agents/heartbeat
    public async Task Heartbeat(string printerName, string version, string os)
    {
        var body = JsonSerializer.Serialize(new { printerName, version, os });
        await _http.PostAsync($"{_baseUrl}/agents/heartbeat",
            new StringContent(body, Encoding.UTF8, "application/json"));
    }
}
```

### 9.3 Socket.IO client setup (C#)

```csharp
using SocketIOClient;

public class RealtimeClient
{
    private readonly SocketIO _socket;

    public RealtimeClient(string url, string jwt)
    {
        _socket = new SocketIO(url, new SocketIOOptions
        {
            Path = "/",
            Transports = new List<string> { "websocket", "polling" },
            Reconnection = true,
            ReconnectionDelay = 2000
        });

        _socket.OnConnected += async (s, e) =>
        {
            // MUST emit auth immediately after connect
            await _socket.EmitAsync("auth", new { token = jwt });
        };

        _socket.On("auth-ok", res => { Console.WriteLine("Socket auth OK"); });
        _socket.On("auth-error", res =>
        {
            Console.WriteLine("Socket auth failed — refresh JWT");
            // Re-exchange device token → JWT + reconnect
        });

        _socket.On("job.dispatch", async res =>
        {
            var job = res.GetValue<JobDispatchPayload>();
            await OnJobReceived?.Invoke(job);
        });

        _socket.On("agent.revoked", res =>
        {
            var payload = res.GetValue<AgentRevokedPayload>();
            if (payload.agentId == _myAgentId)
            {
                OnRevoked?.Invoke();
            }
        });
    }

    public event Func<JobDispatchPayload, Task> OnJobReceived;
    public event Action OnRevoked;

    public async Task ConnectAsync() => await _socket.ConnectAsync();
    public async Task DisconnectAsync() => await _socket.DisconnectAsync();
}
```

### 9.4 Print job handler (C#)

```csharp
public async Task HandleJob(JobDispatchPayload job)
{
    // 1. Download PDF
    var pdfBytes = await _httpClient.GetByteArrayAsync(job.downloadUrl);
    var tempPath = Path.Combine(_pdfCacheDir, $"{job.jobId}.pdf");
    await File.WriteAllBytesAsync(tempPath, pdfBytes);

    // 2. Atomic claim
    var claimResult = await _backend.ReportJobStatus(job.jobId, "printing", null);
    if (claimResult.skipped)
    {
        File.Delete(tempPath);
        return; // Another agent got it
    }

    // 3. Print
    try
    {
        await PrintPdf(tempPath, job.copies, job.colorMode, job.duplex, job.paperSize);
        await _backend.ReportJobStatus(job.jobId, "completed", null);
    }
    catch (Exception ex)
    {
        await _backend.ReportJobStatus(job.jobId, "failed", ex.Message);
    }
    finally
    {
        File.Delete(tempPath);
    }
}
```

---

## 10. Gateway (Caddy) — Important

The Caddy gateway at port 443 routes based on the `XTransformPort` query parameter:

```
https://printshop-saas-three.vercel.app/?XTransformPort=3003  →  localhost:3003 (Socket.IO)
https://printshop-saas-three.vercel.app/                       →  localhost:3000 (Next.js)
```

**For REST API calls:** no query parameter needed — just `https://printshop-saas-three.vercel.app/api/v1/...`

**For Socket.IO:** MUST include `?XTransformPort=3003` in the URL.

**For WebSocket connections:** the URL is `wss://printshop-saas-three.vercel.app/?XTransformPort=3003` (Caddy upgrades to WebSocket).

---

## 11. Security Notes

### 11.1 Device token storage

Store the device token using **Windows DPAPI** (CurrentUser scope):
```csharp
byte[] plaintext = Encoding.UTF8.GetBytes(deviceToken);
byte[] encrypted = ProtectedData.Protect(plaintext, null, DataProtectionScope.CurrentUser);
File.WriteAllBytes(deviceTokenPath, encrypted);
```

Only the Windows user who paired can decrypt it.

### 11.2 Token redaction in logs

Never log the full device token or JWT. Redact:
```csharp
private string RedactToken(string token) =>
    token.Length > 8 ? token[..4] + "..." + token[^4..] : "***";
```

### 11.3 Tenant isolation

The device token resolves to a `shopId` on the server. PrintEXE can ONLY access data for its own shop. The server enforces this at 3 layers:
1. Auth (device token → PrintAgent.shopId)
2. Query (every SELECT filters by shopId)
3. Mutation (shopId is forcibly set from the principal, never from the request)

PrintEXE never sends a `shopId` in requests — the server knows it from the token.

---

## 12. Offline Behavior

### 12.1 Local SQLite queue (allowed)

PrintEXE may use a local SQLite database as a **transit cache** for print jobs:
- Store downloaded jobs before printing
- Queue status reports when offline
- Purge after 7 days

This is NOT a "business database" — it's a print spooler cache. The server is authoritative.

### 12.2 Offline → online sync

When PrintEXE reconnects:
1. Flush queued status reports via `POST /agents/jobs/{id}/status`
2. Pull new jobs via `GET /agents/jobs/pending`
3. Sync any customer changes via `POST /sync/push` + `GET /sync/pull`

### 12.3 Crash recovery

On PrintEXE startup:
1. Check local SQLite for jobs in "printing" state
2. These jobs may or may not have been printed before the crash
3. Query the server: `GET /agents/jobs/pending` — if the job is still in "printing" state on the server, it was NOT completed → reprint
4. If the server shows "completed" → mark as done locally (the print succeeded before the crash)

---

## 13. Quick Start Checklist

To build PrintEXE against this backend:

1. ✅ Read this document completely
2. ✅ Set `Backend.BaseUrl` to `https://printshop-saas-three.vercel.app`
3. ✅ Implement the "paste token" pairing flow (shopkeeper generates token on web, pastes into PrintEXE)
4. ✅ Store the device token with DPAPI
5. ✅ Implement `POST /api/v1/agents/token` to exchange device token → JWT
6. ✅ Implement `GET /api/v1/agents/jobs/pending` polling (every 2s)
7. ✅ Implement `POST /api/v1/agents/jobs/{id}/status` (claim → print → complete/fail)
8. ✅ Implement `POST /api/v1/agents/heartbeat` (every 60s)
9. ✅ Implement Socket.IO connection with `?XTransformPort=3003` + `auth` event
10. ✅ Listen for `job.dispatch` events
11. ✅ Download PDFs from presigned URLs
12. ✅ Print via SumatraPDF or Windows spooler
13. ✅ Implement `DELETE /api/v1/agents/{id}` handling (if revoked, show "Device revoked")
14. ✅ (Optional) Implement sync: `GET /sync/pull` + `POST /sync/push` + `GET /sync/status`
15. ✅ Test against production: `https://printshop-saas-three.vercel.app`

---

## 14. Test Credentials

**Production shop (verified):**
- Shop: "Arjun Print Hub" (slug: `arjun-print-hub`)
- Owner email: (contact the repo owner)
- API returns: `bwA4PerPage: 200 (₹2)`, `colorA4PerPage: 600 (₹6)`, `minOrderValue: 500 (₹5)`

**To test pairing:**
1. Login to `https://printshop-saas-three.vercel.app/shop/login` as the shop owner
2. Go to Printer Setup → Register new agent
3. Copy the device token
4. Paste into PrintEXE

**To verify connectivity:**
```bash
curl -s https://printshop-saas-three.vercel.app/api/v1/health
# → {"success":true,"data":{"status":"ok"}}
```

---

## 15. Reference Files in the Backend Repo

| File | What to read |
|---|---|
| `src/app/api/v1/agents/register/route.ts` | Registration DTO + token generation |
| `src/app/api/v1/agents/token/route.ts` | Token → JWT exchange |
| `src/app/api/v1/agents/heartbeat/route.ts` | Heartbeat DTO |
| `src/app/api/v1/agents/jobs/pending/route.ts` | Job DTO + presigned URL resolution |
| `src/app/api/v1/agents/jobs/[id]/status/route.ts` | Status DTO + atomic claim logic |
| `src/app/api/v1/agents/[id]/route.ts` | DELETE (revocation) |
| `src/lib/api/with-auth.ts` | `withDeviceAuth` implementation (how the token is verified) |
| `src/lib/auth/jwt-auth.adapter.ts` | JWT format + signing |
| `mini-services/realtime-service/index.ts` | Socket.IO server + auth + event broadcast |
| `src/components/phase5/use-realtime.ts` | Browser Socket.IO client (reference for event names) |
| `prisma/schema.prisma` | Full database schema |
| `Caddyfile` | Gateway routing (`XTransformPort` query) |
| `.env.example` | All environment variables |

# PrintEXE Realtime Events (Socket.IO)

> The realtime channel: connection URL, auth handshake, events to listen for,
> events NOT to emit, reconnection, and polling fallback. Source of truth:
> `mini-services/realtime-service/index.ts` (the Socket.IO server),
> `src/components/phase5/use-realtime.ts` (the reference browser client),
> `Caddyfile` (gateway routing).

PrintEXE connects to the PrintShop Socket.IO server to receive push notifications
of new jobs, agent revocations, delivery receipts, and sync batches. Socket.IO
is **receive-only** for PrintEXE — the only event PrintEXE emits is the initial
`auth` handshake.

---

## 1. Connection URL

```
wss://printshop-saas-three.vercel.app/?XTransformPort=3003
```

The `?XTransformPort=3003` query parameter is **REQUIRED**. The Caddy gateway
at port 443 routes based on it (Caddyfile lines 2–13):

```
@transform_port_query {
  query XTransformPort=*
}
handle @transform_port_query {
  reverse_proxy localhost:{query.XTransformPort}
}
handle {
  reverse_proxy localhost:3000      # Next.js app (default)
}
```

- With `XTransformPort=3003` → Caddy proxies to `localhost:3003` (Socket.IO).
- Without it → Caddy proxies to `localhost:3000` (Next.js app, which does NOT
  serve Socket.IO — connection fails with HTTP 400).

WebSocket upgrade: Caddy handles the `Upgrade: websocket` header transparently.

---

## 2. Socket.IO options

```csharp
var client = new SocketIO(
    "https://printshop-saas-three.vercel.app/?XTransformPort=3003",
    new SocketIOOptions {
        Path = "/",
        Transports = new List<string> { "websocket", "polling" },
        Reconnection = true,
        ReconnectionAttempts = int.MaxValue,   // retry forever
        ReconnectionDelay = 2000,              // 2 s base
        Timeout = TimeSpan.FromSeconds(8)
    });
```

Server-side config (`mini-services/realtime-service/index.ts` lines 84–89):
```ts
const io = new Server(wsHttp, {
  path: '/',
  cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] },
  pingTimeout: 60000,    // 60 s — tolerate slow networks
  pingInterval: 25000,   // 25 s heartbeat
});
```

The browser reference client (`use-realtime.ts`) sets `reconnectionAttempts: 10`
— PrintEXE should set it to `int.MaxValue` so it reconnects indefinitely (the
dashboard is short-lived; PrintEXE is a daemon).

---

## 3. Auth handshake

After `connect`, PrintEXE MUST emit `auth` with the JWT from
`POST /api/v1/agents/token`:

```csharp
client.OnConnected += async (s, e) => {
    var jwt = await ExchangeDeviceTokenForJwt(deviceToken);
    await client.EmitAsync("auth", new { token = jwt });
};
```

Server-side (`realtime-service/index.ts` lines 91–114):
```ts
io.on('connection', (socket) => {
  socket.on('auth', (data: { token?: string }) => {
    const token = data?.token;
    if (!token) { socket.emit('auth-error', {message:'missing token'}); socket.disconnect(true); return; }
    const claims = verifyJwt(token);   // HS256 with JWT_ACCESS_SECRET
    if (!claims || !claims.shopId) { socket.emit('auth-error', {message:'invalid or expired token'}); socket.disconnect(true); return; }
    socket.data.claims = claims;
    socket.join(`shop:${claims.shopId}`);
    socket.emit('auth-ok', { shopId: claims.shopId, role: claims.role });
  });
});
```

**Server responses:**
- `auth-ok` `{shopId, role}` → joined to room `shop:<shopId>`. PrintEXE now
  receives all events broadcast to that room.
- `auth-error` `{message}` → socket disconnected. Refresh the JWT
  (`POST /agents/token`) and reconnect.

If PrintEXE emits ANY other event before `auth`, the server silently ignores it
(there is no listener for it). If the socket disconnects before auth, reconnect
and retry.

---

## 4. Events PrintEXE MUST listen for

| Event | Payload | Required action |
|---|---|---|
| `job.dispatch` | `{jobId, fileId, orderId?, filename, downloadUrl, copies, colorMode, duplex, paperSize, pageRange, deliveryAttemptId}` | Download the PDF from `downloadUrl`, claim via `POST /agents/jobs/{id}/status {status:'printing'}`, print, then report `completed`/`failed`. Also call `POST /agents/jobs/{id}/received` (v0.5.x) once the file is durably saved. |
| `agent.revoked` | `{agentId, agentName, cancelledJobs}` | If `agentId === myAgentId` → STOP everything: stop polling, stop heartbeat, disconnect Socket.IO, wipe the local device token, show "Device revoked" UI. |
| `delivery.received` | `{jobId, agentId, agentName, receivedAt, checksum?}` | Confirmation that the receipt call landed. Useful for local log reconciliation — no action required. |
| `sync.pushed` | `{count, deviceId}` | New data available on the server → trigger an immediate `GET /sync/pull` (v0.5.x). `deviceId` is the agent that pushed, useful for de-duplication if your device just pushed. |

### 4.1 Events PrintEXE MAY listen for (informational only)

| Event | Payload | When |
|---|---|---|
| `order.paid` | `{orderId, amountPaise}` | New paid order — refresh local dashboard tile (optional). |
| `order.ready` | `{orderId}` | Order fully printed — refresh local dashboard tile (optional). |
| `job.printing` | `{jobId, fileId}` | Another agent in this shop started a job — useful for "who's printing what" displays. |
| `job.completed` | `{jobId, fileId}` | Another agent completed a job — update local dashboard. |
| `job.failed` | `{jobId, fileId, error}` | Another agent failed a job — surface in UI. |
| `job.needs_review` | `{jobId, fileId}` | A job moved to `needs_review` by the stale-recovery worker — if it's one of "your" in-flight jobs, stop retrying. |
| `order.collected` | `{orderId}` | Shopkeeper marked the order collected — informational. |

The reference browser client (`use-realtime.ts` line 44) listens to a smaller
set: `['order.paid','order.ready','job.printing','job.completed','order.collected']`.
PrintEXE should subscribe to the superset above (its lifecycle is more
elaborate than the dashboard's).

---

## 5. Events PrintEXE MUST NOT emit

PrintEXE is receive-only on Socket.IO. The only emit is `auth`. Specifically,
do NOT emit any of:

- `AckJob`, `ReportStatus`, `Heartbeat`, `DeliverJob`, `claim`, `complete`,
  `fail` — there are no server-side listeners for these. They will be silently
  dropped (and at high volume, may trigger Socket.IO's built-in rate limiter).
- Anything starting with `~` or containing `..` — Caddy may strip these.

ALL PrintEXE → server communication is via REST:
- Heartbeat → `POST /api/v1/agents/heartbeat`
- Job status → `POST /api/v1/agents/jobs/{id}/status`
- Receipt → `POST /api/v1/agents/jobs/{id}/received`
- Sync → `GET /api/v1/sync/pull` + `POST /api/v1/sync/push` + `GET /api/v1/sync/status`
- Token refresh → `POST /api/v1/agents/token`

The Socket.IO server only has ONE inbound handler (`auth`); everything else is
outbound from the server's `/emit` HTTP relay (which PrintEXE never calls — that
relay is server-to-server, authenticated with `REALTIME_EMIT_SECRET`).

---

## 6. Reconnection behaviour

### 6.1 Default Socket.IO reconnection

The library handles reconnection automatically:
- Initial backoff: `ReconnectionDelay` (2 s).
- Exponential backoff with jitter; capped at ~5× base.
- On every successful reconnect, the `connect` event fires again → PrintEXE
  re-emits `auth` with the (possibly cached) JWT.

### 6.2 JWT staleness during reconnect

If the cached JWT is older than 900 s (15 min), the server responds `auth-error: "invalid or expired token"`. PrintEXE must: (1) catch `auth-error`; (2) refresh the JWT via `POST /api/v1/agents/token` (with the device token); (3) re-emit `auth` with the new JWT. If the refresh call itself returns 401, the device has been revoked — proceed to `PRINTEXE_DEVICE_LIFECYCLE.md` §8.

### 6.3 Reconnect storms

Don't emit any queued REST calls during the disconnect window — they will be retried by the polling fallback below. Multiple reconnect attempts in flight can cause duplicate `auth` emits; the server's `auth` handler is idempotent (a second emit re-joins the room), but you should still guard against it.

---

## 7. Polling fallback (every 2 s)

Socket.IO is best-effort. PrintEXE MUST also poll `GET /agents/jobs/pending` as a fallback for job dispatch: `while (running) { if (!socketConnected || !socketAuthed) { try { jobs = await GET /api/v1/agents/jobs/pending; } catch (e) { /* log + continue */ } } await Task.Delay(2000); }`.

Rules:
- **Frequency:** every **2 seconds** when Socket.IO is down or unauthed.
- **When Socket.IO is healthy:** polling may pause (the `job.dispatch` event is authoritative). However, polling ALSO refreshes `lastSeenAt` server-side — so if you pause polling, you MUST keep heartbeats at ≤30 s.
- **Steady-state recommendation:** keep polling at a slower 10–15 s interval even with Socket.IO up; this catches any `job.dispatch` events that were emitted between socket disconnects (the server does NOT queue undelivered events — they're lost).

### 7.1 Idempotent claim makes polling safe

The atomic claim (`UPDATE WHERE status='queued'`) means that even if PrintEXE
polls AND receives a `job.dispatch` for the same job, only one claim succeeds.
The other returns `{skipped:true}`. So overlapping channels are safe.

### 7.2 What polling does NOT cover

Polling does NOT deliver:
- `agent.revoked` events (only Socket.IO). Polling calls will eventually start
  returning 401 (when the row is deleted) — treat that as revocation.
- `delivery.received`, `sync.pushed`, `order.ready`, etc. These are dashboard
  UI updates — PrintEXE doesn't need them for correctness.

---

## 8. CORS + server-side broadcast path

Production `CORS_ALLOWED_ORIGINS` is a comma-separated whitelist. For PrintEXE (a native Windows client, not a browser), CORS does NOT apply — the WebSocket handshake is not subject to same-origin policy. The browser reference client (`use-realtime.ts`) connects via `io('/?XTransformPort=3003')` which inherits the page origin; PrintEXE connects with an absolute URL.

Server-side broadcast path (for context — explains the timing):
1. Next.js route handler calls `container.realtime.publish(shopChannel(shopId), eventName, payload)`.
2. The `SocketIORelayAdapter` POSTs to `http://localhost:3004/emit` with `X-Emit-Secret: ${REALTIME_EMIT_SECRET}` and body `{channel:'shop:<shopId>', event, payload}`.
3. The realtime mini-service verifies the secret (`timingSafeEqual`), checks the channel starts with `shop:` (prevents spoofing system rooms), and calls `io.to(channel).emit(event, payload)`.

Latency: typically <50 ms from server-side event to PrintEXE. Relay body is capped at 64 KB (`MAX_EMIT_BODY`); larger events are dropped (the server's `publish` is best-effort, catches errors silently).

---

## 9. Quick checklist for the PrintEXE Socket.IO client

1. ✅ Connect to `wss://printshop-saas-three.vercel.app/?XTransformPort=3003`.
2. ✅ Set `Path="/"`, transports `[websocket, polling]`, reconnection on, delay 2 s, attempts infinite.
3. ✅ On `connect`: exchange device token → JWT, emit `auth {token: jwt}`.
4. ✅ On `auth-ok`: mark as authed, start listening for `job.dispatch` etc.
5. ✅ On `auth-error`: refresh JWT, re-emit `auth` once. If refresh 401 → revoke.
6. ✅ On `disconnect`: pause event processing, start polling fallback.
7. ✅ On `agent.revoked` where `agentId === myAgentId`: shut down.
8. ✅ On `job.dispatch`: download → claim → print → receipt (v0.5.x) → status.
9. ✅ On `sync.pushed`: trigger `GET /sync/pull` immediately (v0.5.x).
10. ❌ Never emit anything except `auth`.

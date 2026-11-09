# PrintEXE Device Lifecycle

> How a PrintEXE install is born, paired, kept alive, and revoked. Source of
> truth: `src/app/api/v1/agents/register/route.ts`, `.../[id]/route.ts`,
> `src/lib/api/with-auth.ts` (`withDeviceAuth`),
> `src/lib/repositories/print-agent.repository.ts`,
> `src/lib/services/delivery-coordinator.ts` (`STALE_THRESHOLD_SECONDS = 30`).

A "device" is one row in the `PrintAgent` table. The row holds the shopId, the
HMAC-SHA256 hash of the device token, presence state, and metadata. It is
created by the shopkeeper (via the web dashboard) and destroyed by the
shopkeeper (or implicitly when the PrintEXE install is decommissioned).

---

## 1. Lifecycle states

```
   ┌─────────────┐      shopkeeper calls
   │  (none)     │      POST /agents/register
   └─────────────┘ ──────────────────────────┐
                                              ▼
                                   ┌──────────────────────┐
                                   │  registered          │
                                   │  isOnline=false      │
                                   │  lastSeenAt=null     │
                                   └──────────────────────┘
                                              │ first heartbeat
                                              │ (or any authenticated call)
                                              ▼
                                   ┌──────────────────────┐  ← every 60 s
                                   │  online              │  ← heartbeat
                                   │  isOnline=true       │
                                   │  lastSeenAt=now      │
                                   └──────────────────────┘
                                              │ lastSeenAt stale > 30 s
                                              ▼
                                   ┌──────────────────────┐
                                   │  offline             │
                                   │  (still in DB)       │
                                   └──────────────────────┘
                                              │ DELETE /agents/{id}
                                              ▼
                                   ┌──────────────────────┐
                                   │  revoked             │
                                   │  (row deleted)       │
                                   └──────────────────────┘
```

`isOnline` is a boolean column that `withDeviceAuth` flips to `true` on every
authenticated call. The dashboard's notion of "online" is **derived**, not
stored: `lastSeenAt` within the last 30 s → online, else offline.

---

## 2. Registration (step 1 — happens on the web dashboard, NOT in PrintEXE)

1. Shopkeeper logs into `https://printshop-saas-three.vercel.app/shop/login`
   (owner JWT issued).
2. Shopkeeper opens the Printer Setup page → clicks "Register new agent".
3. Web app calls:
   ```
   POST /api/v1/agents/register
   Authorization: Bearer <ownerJWT>
   {"name":"Front Desk PC","os":"win32","version":"1.0.0","printerName":"HP LaserJet"}
   ```
4. Server (`agents/register/route.ts`):
   - Resolves shop via `repos.shops.getByOwner(principal.userId)`.
   - Generates `token = crypto.randomUUID() + '-' + crypto.randomUUID()`.
   - Computes `tokenHash = HMAC-SHA256('print-agent-salt', token).hex()`.
   - Inserts a `PrintAgent` row with `{id: <uuid>, shopId, name, tokenHash,
     isOnline:false, lastSeenAt:null, ...metadata}`.
5. Returns the plaintext `deviceToken` to the web ONCE. The web shows it in a
   modal with the warning `"Save this token — it is shown only once."`.

PrintEXE is not involved in this step. The shopkeeper copy-pastes the token out
of the web UI into PrintEXE's pairing field.

---

## 3. Token display + pairing

The token is returned **only in the registration response**. The web dashboard
does NOT persist the plaintext — only the hash is in the DB. Closing the modal
without copying means re-registering (the old row can be revoked from the agent
list).

PrintEXE's pairing screen:
1. Single input field labelled "Paste the device token from your dashboard."
2. Validate locally: must match `/^[0-9a-f-]{73}$/` (two UUIDs joined by `-`).
3. On submit: encrypt with Windows DPAPI (CurrentUser scope) → write to
   `%AppData%/PrintShop/Companion/device.dat`.
4. Immediately POST `/agents/heartbeat` once with `{printerName, version, os}`.
   A 200 confirms the token is valid; a 401 means the paste was wrong (or the
   shopkeeper revoked before PrintEXE paired).

After pairing, PrintEXE never asks the user for credentials again.

---

## 4. First heartbeat

A successful `POST /agents/heartbeat` (or any authenticated call) flips `isOnline=true` and stamps `lastSeenAt = NOW()`. From this point the dashboard shows the device with a green dot.

PrintEXE should: (1) send `POST /agents/heartbeat` immediately after pairing; (2) start the 60-second heartbeat loop; (3) connect Socket.IO (see `PRINTEXE_REALTIME_EVENTS.md`); (4) start polling `/agents/jobs/pending` as a Socket.IO fallback.

---

## 5. Online / offline detection

The dashboard uses **30 seconds** as the staleness threshold (`STALE_THRESHOLD_SECONDS = 30` in `src/lib/services/delivery-coordinator.ts`, also enforced by `PrintAgentRepository.isAnyOnline(shopId, staleSeconds=30)`):
```ts
const ageSeconds = (now - lastSeenAt.getTime()) / 1000;
return ageSeconds <= 30;
```

A device is "online" iff `lastSeenAt !== null` AND `now - lastSeenAt <= 30 s`.

PrintEXE controls this by sending a heartbeat every 60 s — wait, 60 s vs 30 s threshold? **No problem** — every authenticated call (heartbeat, job poll, status update, sync pull) ALSO refreshes `lastSeenAt`. So in steady state: polling `/agents/jobs/pending` every 2 s → `lastSeenAt` is always fresh; the 60 s heartbeat is the BACKUP for when polling is paused (idle shop, no jobs).

If the shop has zero queued jobs and Socket.IO is connected, polling may pause, and the 60 s heartbeat alone keeps `lastSeenAt` fresh enough — but only JUST. **Recommendation:** keep heartbeat at 30 s if you're not polling, otherwise heartbeats can lapse past the threshold.

---

## 6. Heartbeat refresh

```
POST /api/v1/agents/heartbeat
Authorization: Bearer <deviceToken>
{"printerName":"HP LaserJet","version":"1.0.0","os":"win32"}
```

All fields optional. Missing fields RETAIN the previous value (the route does `body.printerName ?? agent.printerName`). Response: `{"success":true,"data":{"agentId":"...","online":true,"ts":"2025-11-07T10:00:00.000Z"}}`.

Behaviour:
- **60-second interval** (default; see `Backend.HeartbeatIntervalSeconds`).
- Best-effort: if the network is flaky, skip a beat rather than retry-storm. The next successful call resets the timer.
- On 401 → token is revoked (see §8). On 429 → back off 2×.
- The heartbeat body is also a vehicle for reporting the local printer name + agent version back to the dashboard.

---

## 7. Presence during normal operation

PrintEXE's call schedule (in steady state):

| Call | Frequency | Effect on `lastSeenAt` |
|---|---|---|
| Heartbeat | every 60 s | yes |
| Poll pending jobs | every 2 s (only if Socket.IO down) | yes |
| Job status update | on event (claim/complete/fail) | yes |
| Sync pull | every 60 s (v0.5.x) | yes |
| Socket.IO `auth` emit | on (re)connect | **no** (Socket.IO does not call `withDeviceAuth`) |

**Socket.IO does NOT refresh presence.** If PrintEXE is connected to Socket.IO
but hasn't made a REST call in 31 s, the dashboard will show it offline. So
keep heartbeating even with a live Socket.IO connection.

---

## 8. Revocation

### 8.1 Trigger

The shopkeeper clicks "Revoke" on the dashboard's agent list. The web calls:

```
DELETE /api/v1/agents/{agentId}
Authorization: Bearer <ownerJWT>
```

### 8.2 Server-side (`agents/[id]/route.ts`)

1. `repos.printAgents.findByIdAndShop(agentId, shop.id)` — tenant isolation. If
   not found → 404 `Print agent not found in your shop.`
2. Find all `PrintJob` rows where `agentId = agent.id AND status = 'queued'`,
   set `agentId = null` (return them to the pool so another agent can pick
   them up). Jobs in `printing` state are LEFT ALONE — the previous agent may
   have already spooled them.
3. **Delete the PrintAgent row.** The `tokenHash` is gone → every future
   `withDeviceAuth` call from this device returns 401.
4. Insert an `AuditLog` entry (`action:'agent.revoke'`).
5. Publish `agent.revoked` realtime event to the shop room
   (`{agentId, agentName, cancelledJobs}`).
6. Return `{agentId, agentName, revoked:true, cancelledJobs, message}`.

### 8.3 PrintEXE's response to revocation

Two paths, both must be handled:

**Path A — `agent.revoked` Socket.IO event received:**
- Payload: `{agentId, agentName, cancelledJobs}`.
- Compare `payload.agentId === myAgentId`. If yes:
  1. Stop heartbeat + polling loops.
  2. Disconnect Socket.IO.
  3. Wipe the local DPAPI-encrypted device token.
  4. Show the "This PC was revoked" screen with the `cancelledJobs` count.

**Path B — REST call returns 401 (token hash no longer in DB):**
- The `withDeviceAuth` flow: `findByTokenHash` misses → `UnauthorizedError:
  Unknown device token` → 401.
- Treat identically to Path A, but without the `cancelledJobs` count.

In both paths, PrintEXE MUST NOT auto-retry the failed call indefinitely. The
shopkeeper must re-pair with a fresh token to recover.

---

## 9. Multi-device shops

A shop may have multiple PrintAgent rows. Each gets its own token. They all share the same `shopId` and compete for queued jobs via the atomic claim (`UPDATE WHERE status='queued'`). When one device is revoked, the others continue working — the only visible effect is the revoked device's queued jobs returning to the pool.

PrintEXE should:
- Detect its own `agentId` from the `POST /agents/token` response (the JWT's `sub` is `agent:<agentId>`) or from the `agentId` field in heartbeat / pending-jobs responses.
- Only react to `agent.revoked` events whose `agentId` matches its own.

---

## 10. Recovery from crashes

On startup, PrintEXE:
1. Load the device token from DPAPI storage. If the file is missing or corrupt, show the pairing screen (the device hasn't been paired on this Windows profile).
2. Send `POST /agents/heartbeat`. On 401 → device was revoked while PrintEXE was offline → show the revoked screen.
3. On 200 → resume normal operation.
4. Inspect local SQLite queue for jobs in `printing` state that were in flight when PrintEXE crashed. Query the server (via `/agents/jobs/pending`) — if the server shows `printing` AND `startedAt > now - 5 min`, resume printing; if the server shows `needs_review` (stale-recovered by `recoverStaleJobs`), DO NOT reprint — surface the conflict to the shopkeeper.

The 5-minute threshold (`STALE_THRESHOLD_MS = 5 * 60 * 1000` in `src/lib/services/durable-queue.ts`) is the server's automatic recovery window. A `printing` job older than 5 min is moved to `needs_review`, NOT re-queued — this prevents duplicate prints when the crashed agent might have actually printed but failed to ACK.

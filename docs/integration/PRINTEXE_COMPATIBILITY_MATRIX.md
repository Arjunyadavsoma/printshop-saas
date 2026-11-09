# PrintEXE Compatibility Matrix

> Which PrintEXE versions support which features, and what's required vs.
> optional per version. Source of truth: the route handlers themselves (which
> endpoints exist), `docs/PRINTEXE_WEBSITE_INTEGRATION_AUDIT.md` (v0.4.7
> WebRTC gap), `docs/PRODUCTION_READINESS_AUDIT.md` (v0.5.2 compatibility
> check), `docs/RELEASE_COMPATIBILITY.md` (versioning policy).

The PrintShop backend is on API v1 (frozen — additive changes only). The
PrintEXE desktop client is versioned independently with SemVer. This document
tracks which PrintEXE versions are compatible with which backend features, and
what each version MUST implement vs. MAY skip.

---

## 1. PrintEXE version history (target)

| Version | Status | Backend target | Key features |
|---|---|---|---|
| v0.4.7 | Legacy — supported | API v1 (current) | Polling, presigned URLs, status reports. NO receipt. NO sync. |
| v0.5.x | Current — supported | API v1 (current) | Adds receipt endpoint, sync pull/push/status, delivery-attempt tracking. |
| v1.0.0 | Target release | API v1 (current) | Adds auto-update, MSI installer, code signing. |
| v1.1.x | Future | API v1 (current) | Adds offline customer directory (sync push). |
| v2.0.0 | Future | API v2 (future) | WebRTC direct transfer (server-side already feature-flagged). |

The server has NOT enforced a `MIN_DESKTOP_VERSION` yet (`MIN_DESKTOP_VERSION =
'1.0.0'` is the planned floor — see `docs/RELEASE_COMPATIBILITY.md` §4.2). For
now, v0.4.7 and v0.5.x both work against the current backend without an upgrade
block.

---

## 2. Feature matrix

| Feature | v0.4.7 | v0.5.x | v1.0.0 | v1.1.x | v2.0.0 |
|---|---|---|---|---|---|
| **Auth** | | | | | |
| Owner JWT login (web only) | n/a | n/a | n/a | n/a | n/a |
| Device token storage (DPAPI) | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| JWT exchange (`POST /agents/token`) | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| **Device lifecycle** | | | | | |
| `POST /agents/heartbeat` (60 s) | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| `DELETE /agents/{id}` (revocation) — web | ✅ supported | ✅ supported | ✅ supported | ✅ supported | ✅ supported |
| Online/offline (30-s threshold) | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| **Job dispatch** | | | | | |
| Socket.IO `job.dispatch` event | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| Polling `GET /agents/jobs/pending` (2 s) | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| Atomic claim `POST /jobs/{id}/status {printing}` | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| Status reports (`completed` / `failed`) | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| **Delivery** | | | | | |
| Presigned URL download (15-min TTL) | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required (fallback) |
| Receipt `POST /jobs/{id}/received` | ❌ NOT supported | ✅ required | ✅ required | ✅ required | ✅ required |
| Cloud cleanup (15-min grace after receipt) | ❌ server-side, no client impact | ✅ server-side | ✅ server-side | ✅ server-side | ✅ server-side |
| WebRTC direct transfer | ❌ | ❌ | ❌ | ❌ | ✅ feature-flagged |
| **Sync (Phase 5)** | | | | | |
| `GET /sync/pull` | ❌ NOT supported | ✅ required | ✅ required | ✅ required | ✅ required |
| `POST /sync/push` (Customer only) | ❌ NOT supported | ✅ optional | ✅ optional | ✅ required | ✅ required |
| `GET /sync/status` | ❌ NOT supported | ✅ optional | ✅ optional | ✅ required | ✅ required |
| **Realtime events** | | | | | |
| `auth` handshake | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| `job.dispatch` listen | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| `agent.revoked` listen | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| `delivery.received` listen | ❌ skip | ✅ optional | ✅ optional | ✅ optional | ✅ optional |
| `sync.pushed` listen | ❌ skip | ✅ optional | ✅ optional | ✅ required | ✅ required |
| `order.paid`, `order.ready`, `job.printing`, `job.completed` | ❌ skip | ✅ optional | ✅ optional | ✅ optional | ✅ optional |
| **Stale recovery** | | | | | |
| `job.needs_review` listen | ✅ required | ✅ required | ✅ required | ✅ required | ✅ required |
| 5-min stale → `needs_review` (server-side) | ✅ server-side | ✅ server-side | ✅ server-side | ✅ server-side | ✅ server-side |
| **Packaging** | | | | | |
| MSI installer + code signing | ❌ | ❌ | ✅ required | ✅ required | ✅ required |
| Auto-update prompt on startup | ❌ | ❌ | ✅ required | ✅ required | ✅ required |
| `X-PrintShop-Companion-Version` header | ❌ | ✅ optional | ✅ required | ✅ required | ✅ required |

---

## 3. v0.4.7 — the legacy baseline

### 3.1 What v0.4.7 implements

The original cloud-delivery flow:
1. Shopkeeper pairs PrintEXE with the device token (DPAPI-encrypted).
2. PrintEXE connects to Socket.IO, emits `auth` with a JWT from
   `POST /agents/token`.
3. Listens for `job.dispatch` events.
4. Polls `GET /agents/jobs/pending` every 2 s as fallback.
5. On a job: downloads PDF from presigned URL → atomic claim via
   `POST /agents/jobs/{id}/status {status:'printing'}` → prints → reports
   `completed` or `failed`.
6. Sends `POST /agents/heartbeat` every 60 s.
7. Listens for `agent.revoked` to handle deactivation gracefully.

### 3.2 What v0.4.7 does NOT implement

- **No receipt endpoint.** The PDF stays in cloud storage until the order is
  marked `collected` by the shopkeeper (or expires after retention policy).
  This means: if the shopkeeper forgets to mark an order collected, the PDF
  stays in storage indefinitely — a GDPR/retention concern.
- **No sync.** v0.4.7 cannot create offline customers. Walk-in customers must
  be entered via the web dashboard.
- **No `delivery.received` / `sync.pushed` event handling.** v0.4.7 ignores
  these events on the wire (they're additive — the server doesn't require
  PrintEXE to listen).
- **No `X-PrintShop-Companion-Version` header.** The server can't tell which
  version is calling — telemetry is blind.

### 3.3 Honest gap

v0.4.7 will continue to work against the current API v1 backend indefinitely —
the server has not broken any of its endpoints. But it loses:
- The 15-minute cloud cleanup window (files linger longer).
- Offline customer creation.
- Server-side delivery-attempt tracking (the dashboard can't show "received by
  agent X at time T").

**Recommendation:** migrate v0.4.7 installations to v0.5.x at the next
maintenance window.

---

## 4. v0.5.x — the current baseline

### 4.1 What v0.5.x adds over v0.4.7

1. **Receipt endpoint** — `POST /api/v1/agents/jobs/{jobId}/received`. Called
   after the PDF is downloaded + verified locally. The server marks the
   delivery attempt `received` and schedules cloud cleanup at `now + 15 min`.
2. **Sync endpoints** — `GET /api/v1/sync/pull`, `POST /api/v1/sync/push`,
   `GET /api/v1/sync/status`. Per-device cursors, last-write-wins conflict
   resolution, `Customer` entity only in v1.
3. **Realtime events** — `delivery.received` (confirmation of own receipt),
   `sync.pushed` (trigger immediate pull).
4. **Version header** — `X-PrintShop-Companion-Version` on every call.

### 4.2 What v0.5.x MUST do

- Implement the receipt call (it's the only way to trigger cloud cleanup).
  Without it, files persist in storage past the 15-minute grace window.
- Implement sync pull on startup (so the local cache is fresh after offline
  periods). Sync push is OPTIONAL in v0.5.x — it becomes REQUIRED in v1.1.x
  when the offline customer directory feature lands.
- Implement the version header on every REST call.

### 4.3 What v0.5.x MAY skip

- WebRTC direct transfer — see §5.
- Auto-update / MSI packaging — those land in v1.0.0.
- Customer creation via sync push — only if the shop has no walk-in flow.

---

## 5. Future — v2.0.0 WebRTC direct transfer

The server-side architecture is **already feature-flagged** for WebRTC direct
transfer (`src/lib/services/delivery-coordinator.ts`):

```ts
// Current delivery mode: cloud staging (presigned URL).
// Future delivery mode: direct WebRTC transfer (feature-flagged, not active
// until PrintEXE supports it — see docs/DIRECT_TRANSFER_PROTOCOL.md).
```

The `ReceiptSchema` already accepts a `transferId: z.string().uuid().optional()`
field for future WebRTC transfers — PrintEXE v0.5.x can ignore it.

From `docs/PRINTEXE_WEBSITE_INTEGRATION_AUDIT.md`:

> **⚠️ Cannot implement until PrintEXE supports WebRTC** — the current
> companion (v0.4.7) does not have WebRTC capabilities. Build server-side
> architecture behind a feature flag; activate when PrintEXE is upgraded.

So: server is ready, client is not. v2.0.0 of PrintEXE will add WebRTC and a
negotiation handshake. Until then, ALL versions use the cloud-staging path
(presigned URLs).

The existing API contract does NOT break when WebRTC lands — it's additive:
- The `job.dispatch` event gains an optional `deliveryMode: 'cloud' | 'direct'`
  field.
- A new `POST /agents/transfers/{transferId}/signal` endpoint is added for
  WebRTC signaling.
- The receipt endpoint accepts `transferId` instead of `deliveryAttemptId`.

v0.4.7 and v0.5.x PrintEXE will continue to receive `deliveryMode: 'cloud'`
dispatches (the server falls back to cloud for clients that don't advertise
WebRTC support).

---

## 6. Required vs. optional — quick checklist per version

### 6.1 To ship a v0.4.7-compatible PrintEXE

```
✅ POST /agents/register (web-only — PrintEXE doesn't call)
✅ Paste-token pairing flow
✅ DPAPI-encrypted device token storage
✅ POST /agents/token (JWT exchange)
✅ POST /agents/heartbeat (60 s)
✅ GET /agents/jobs/pending (2 s polling fallback)
✅ POST /agents/jobs/{id}/status (atomic claim + completion + failure)
✅ Socket.IO: connect, auth, listen for job.dispatch + agent.revoked
✅ Presigned URL PDF download
❌ POST /agents/jobs/{id}/received — DO NOT CALL (will 404)
❌ /sync/* — DO NOT CALL (will 404)
```

### 6.2 To ship a v0.5.x-compatible PrintEXE — everything in §6.1, PLUS: `POST /agents/jobs/{id}/received` (after every successful download); `GET /sync/pull` (on startup + every 60 s); `GET /sync/status` (on startup); `POST /sync/push` (optional in v0.5.x, required in v1.1.x); Socket.IO: listen for `delivery.received` + `sync.pushed`; `X-PrintShop-Companion-Version` header on every call; version-aware feature flags (don't call `/received` if version < 0.5).

### 6.3 To ship a v1.0.0-compatible PrintEXE — everything in §6.2, PLUS: MSI installer + code signing; auto-update prompt (`GET /api/v1/downloads/companion/latest`); crash recovery (local SQLite queue replay); `X-Request-Id` capture + logging for support.

---

## 7. Backend version negotiation (future)

The server-side `MIN_DESKTOP_VERSION` is planned for the v1.0.0 PrintEXE release. When enforced: parse `X-PrintShop-Companion-Version` header; if version < `MIN_DESKTOP_VERSION` → return `426 Upgrade Required` with `{error:{code:"VERSION_UNSUPPORTED", message:"...", minVersion:"1.0.0", downloadUrl:"https://..."}}`.

Until then, version negotiation is advisory only — the server logs the header but doesn't enforce. v0.4.7 and v0.5.x PrintEXE installations will keep working without an upgrade block until v2.0.0 (which will require API v2 on the backend, a separate concern).

---

## 8. Honest incompatibilities

The following combinations DON'T work and PrintEXE must detect + refuse:

| Combination | Why | Detection |
|---|---|---|
| v0.4.7 PrintEXE calling `POST /agents/jobs/{id}/received` | Endpoint didn't exist | Returns 404 — PrintEXE must log + skip, NOT retry |
| v0.4.7 PrintEXE calling `/sync/*` | Endpoints didn't exist | Returns 404 |
| Any PrintEXE sending a `shopId` in a request body | Tenant isolation | Server force-overwrites; PrintEXE should never send it |
| Any PrintEXE emitting `claim`/`complete`/`fail` Socket.IO events | No server-side listener | Silently dropped — use REST instead |
| PrintEXE without `?XTransformPort=3003` on the Socket.IO URL | Caddy routes to Next.js (port 3000) | Connection fails with HTTP 400 |
| PrintEXE using the owner JWT instead of the device token for REST calls | `withDeviceAuth` rejects (hash lookup misses) | Returns 401 |

These are documented here so PrintEXE can include assertion checks at startup
and surface clear error messages to the shopkeeper, rather than silently
looping on retries.

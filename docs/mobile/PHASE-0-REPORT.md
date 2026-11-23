# Phase 0 Report — Architecture + Schema/API Diff

**Date:** 2026-11-23
**Branch:** `feature/mobile-executor`
**Repo:** printshop-saas (backend)

---

## Current State (read from code)

### PrintAgent (prisma/schema.prisma)
```
id, shopId, name, tokenHash, prevTokenHash, tokenRotatedAt,
lastSeenAt, printerName, isOnline, version, os, isEnabled,
createdAt, updatedAt
```
**Missing for mobile:** `kind` (PC|MOBILE), `platform`, `appVersion`, `capabilities` (string[]), `agentName` (human-readable, separate from `name` which is the daemon name).

### PrintJob (prisma/schema.prisma)
```
id, shopId, fileId, agentId, printerId, kind (color_set|bw_set|full),
sourcePages (Json), taskPdfStorageKey, sheetCount, copies, colorMode,
paperSize, duplex, pagesPerSheet, orientation, scale, setLabel,
idempotencyKey (unique), dispatchedAt, printedAt, status (queued|dispatched|
printing|completed|failed|cancelled), attempts, lastError, queuedAt,
startedAt, completedAt, createdAt, updatedAt
```
**Missing for queue v2:** `priority`, `position` (fractional index), `isHeld`, `executorMode` (AUTO|MANUAL_ONLY), `claimedByAgentId`, `claimLeaseExpiresAt`, `version` (optimistic concurrency), `lastExecutorKind`.

### Printer (prisma/schema.prisma)
```
id, shopId, agentId, systemName, displayName, supportsColor, supportsDuplex,
paperSizes (Json), isDefaultColor, isDefaultBw, status (ONLINE|OFFLINE|PAUSED|ERROR),
statusDetail, speedPpm, pagesPrintedToday, counterDate, lastSeenAt, enabled,
createdAt, updatedAt
```
**Missing:** `printerUuid` (IPP UUID for merging). No `PrinterPath` model exists.

### Device contract (existing routes, all under /api/v1/agents/)
- `POST /register` — owner-authed, mints device token
- `POST /token` — device-authed, rotates token
- `POST /heartbeat` — device-authed, refreshes presence
- `GET /jobs/pending` — device-authed, lists pending jobs for dispatch
- `POST /jobs/[id]/received` — device-authed, acknowledges receipt
- `POST /jobs/[id]/status` — device-authed, reports print status
- `GET /agents/[id]` — owner-authed, agent details

**withDeviceAuth** wrapper (`src/lib/api/with-auth.ts:115`): validates device token via SHA-256 hash comparison, checks `isEnabled`, refreshes `lastSeenAt` + `isOnline`. Works for both PC and mobile agents — no changes needed to the auth wrapper itself.

### Dispatcher (`src/lib/dispatch/task-builder.ts`)
Builds PrintJob tasks from PrintSpec + PrintFile. Splits into color_set / bw_set based on page modes. Creates task PDFs in storage. Called at PAID or QUEUED. **Does NOT auto-dispatch** — the `/jobs/pending` route is polled by the PC agent which pulls jobs.

### Realtime (`src/lib/services/delivery-coordinator.ts`)
Uses `container.realtime.publish(shopChannel(shopId), 'job.dispatch', {...})` to notify the dashboard when a job is dispatched. Socket.io relay to the dashboard mini-service on port 3004.

### Pairing flow
`PairingTicket` model: one-time ticket (hash stored), consumed by the agent to exchange for a device token. `POST /api/v1/shops/me/devices` creates a ticket. The QR encodes the ticket hash. The agent scans the QR → `POST /api/v1/agents/register` with the ticket → gets a device token.

**This flow already works for mobile** — the register route accepts `name`, `os`, `version`, `printerName`. We just need to add `kind`, `platform`, `appVersion`, `capabilities` fields (all optional with defaults).

---

## Schema Diff (additive — old fields untouched)

### PrintAgent additions
```prisma
model PrintAgent {
  // ... existing fields ...
  kind          String    @default("PC")    // PC | MOBILE
  platform      String?                     // android | ios | windows | linux
  appVersion    String?
  capabilities  String    @default("[]")   // JSON array: ["queue.v2","ipp.lan"]
  agentName     String?                     // human-readable: "Ana's phone"
}
```

### PrintJob additions
```prisma
model PrintJob {
  // ... existing fields ...
  priority            Int       @default(0)   // 0 normal, 10 urgent
  position            String    @default("0") // fractional index for drag reorder
  isHeld              Boolean   @default(false)
  executorMode        String    @default("AUTO") // AUTO | MANUAL_ONLY
  claimedByAgentId    String?
  claimLeaseExpiresAt DateTime?
  version             Int       @default(1)   // optimistic concurrency
  lastExecutorKind    String?                  // PC | MOBILE
}
```

### Printer additions
```prisma
model Printer {
  // ... existing fields ...
  printerUuid   String?   // IPP printer-uuid or mDNS UUID for merging
}
```

### New model: PrinterPath
```prisma
model PrinterPath {
  id           String   @id @default(uuid())
  printerId    String
  agentId      String
  kind         String   // WINDOWS_QUEUE | LAN_IPP | RAW9100
  uri          String   // ipp://192.168.1.50:631/ipp/print | windows:HP_LaserJet
  lastSeenAt   DateTime?
  status       String   @default("unknown") // online|offline|error|unknown
  capabilities String   @default("{}")      // JSON: document-format-supported, sides, etc.
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  printer      Printer  @relation(fields: [printerId], references: [id])
  agent        PrintAgent @relation(fields: [agentId], references: [id])

  @@unique([printerId, agentId, kind])
  @@index([printerId])
  @@index([agentId])
}
```

### Relations to add
- `Printer`: add `paths PrinterPath[]`
- `PrintAgent`: add `paths PrinterPath[]`
- `PrintJob`: add `claimedByAgent PrintAgent? @relation(fields: [claimedByAgentId], references: [id])`

---

## API Diff (all additive, backward compatible)

### New endpoints (shopkeeper-authed via `withAuth`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/shop/queue` | List tasks in queue order with executor labels |
| POST | `/api/v1/shop/queue/reorder` | `{taskId, beforeId\|afterId\|toTop}` |
| POST | `/api/v1/shop/tasks/:id/priority` | `{priority}` |
| POST | `/api/v1/shop/tasks/:id/hold` | Set `isHeld=true` |
| POST | `/api/v1/shop/tasks/:id/release` | Set `isHeld=false` |
| POST | `/api/v1/shop/tasks/:id/reroute` | `{printerId, pathId?}` |
| POST | `/api/v1/shop/tasks/:id/reprint` | New attempt (explicit confirmation) |
| POST | `/api/v1/shop/printers/sync` | Agent reports printers + paths |
| GET/PATCH | `/api/v1/shop/printers/:id` | Rename, defaults, enable/disable, merge |
| POST | `/api/v1/shop/walkin` | Create walk-in order from phone uploads |

### Device-agent endpoints (device-authed, for mobile)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/agents/jobs/:id/claim` | Mobile claims a task (returns lease + signed file URL) |
| POST | `/api/v1/agents/jobs/:id/lease/renew` | Renew claim lease (15s heartbeat) |
| POST | `/api/v1/agents/jobs/:id/release` | Give task back to queue |
| POST | `/api/v1/agents/jobs/:id/pullback` | Ask PC to return task (requires PC ack) |
| POST | `/api/v1/agents/jobs/:id/status` | **Existing** — extended with `attempt`, `ippJobId?` |

### Existing endpoints (extended, backward compatible)
| Method | Path | Change |
|--------|------|--------|
| POST | `/api/v1/agents/register` | Add optional `kind`, `platform`, `appVersion`, `capabilities`, `agentName` to Zod schema |
| POST | `/api/v1/agents/heartbeat` | Add optional `capabilities` update |
| GET | `/api/v1/agents/jobs/pending` | Server filters: only `executorMode=AUTO`, `isHeld=false`, unclaimed tasks with eligible PC path. Old PrintEXE builds see no difference. |
| POST | `/api/v1/agents/jobs/:id/status` | Add optional `attempt`, `ippJobId`, `detail` fields. Old builds still send the same body. |

### Socket events (additive)
| Event | Payload | Purpose |
|-------|---------|---------|
| `queue.updated` | `{queueVersion, shopId}` | Queue order/content changed |
| `task.claimed` | `{taskId, agentId, agentName, queueVersion}` | Mobile claimed a task |
| `task.released` | `{taskId, queueVersion}` | Task returned to queue |
| `task.priority.changed` | `{taskId, priority, queueVersion}` | Priority changed |
| `task.held` | `{taskId, held, queueVersion}` | Hold/release |
| `task.status` | `{taskId, status, queueVersion}` | Status update |
| `printer.status` | `{printerId, status, queueVersion}` | Printer state changed |
| `agent.status` | `{agentId, kind, isOnline, queueVersion}` | Agent online/offline |
| `device.revoked` | `{agentId, queueVersion}` | Device revoked |

Every event carries `queueVersion` (monotonically increasing per shop) so clients detect gaps and refetch.

---

## Dispatcher Rules (server is the only gatekeeper)

### PC agent dispatch (unchanged for old builds)
- `/jobs/pending` returns only tasks where: `status='queued'` AND `isHeld=false` AND `executorMode='AUTO'` AND `claimedByAgentId IS NULL` AND the target printer has an eligible PC path (PrinterPath with kind='WINDOWS_QUEUE' and status='online')
- Old PrintEXE builds poll `/jobs/pending` as before — they see fewer tasks (held/manual ones are filtered out) but the response shape is identical

### Mobile agent claim (new)
- `POST /agents/jobs/:id/claim` — device-authed (mobile agent)
- Precondition: task `status` is `queued` OR (`status` is `dispatched` AND PC reports not-started via `pullback` ack)
- Atomic transaction with `version` check: `UPDATE PrintJob SET claimedByAgentId=?, claimLeaseExpiresAt=NOW()+60s, version=version+1 WHERE id=? AND version=? AND claimedByAgentId IS NULL`
- Exactly one claimer wins (the version check guarantees this)
- Returns: `{leaseExpiresAt, signedFileUrl, taskDetails}`

### Lease expiry → UNCERTAIN
- If `claimLeaseExpiresAt` passes without a PRINTED status → task status becomes `uncertain` (never auto-retry)
- Shopkeeper decides: mark printed, reprint (new attempt), or cancel

### Pull back from PC
- Mobile sends `POST /agents/jobs/:id/pullback`
- Server sends a `task.release.request` DeviceCommand to the PC agent
- PC responds with `task.release.ack` (only if task not yet started)
- If PC already started → `409 Already printing on Shop PC`

---

## Queue Ordering

```
ORDER BY
  isHeld ASC,              -- non-held first (held tasks sink)
  priority DESC,           -- urgent (10) before normal (0)
  position ASC,            -- fractional index for drag reorder
  createdAt ASC            -- FIFO for same position
```

Position is a fractional index string (like Jira's lexorank):
- Move to top: `position = "0"` (or before the first item's position)
- Move between A and B: `position = midpoint(A.position, B.position)`
- Move to bottom: `position = last.position + "z"`

---

## What Is Unverified
1. **Prisma migration on production Supabase** — the schema changes are additive (new columns with defaults + new table), but the migration needs to be applied with a direct (non-pooled) DATABASE_URL
2. **Old PrintEXE compatibility** — the `/jobs/pending` filter is server-side, so old builds see no difference. But this needs a contract test to prove it.
3. **Socket.io events on the mini-service** — the realtime mini-service needs to handle the new event types
4. **Fractional index implementation** — needs a library or custom implementation (strings, not floats, to avoid precision issues)

---

## Next Phase

**Phase 1: Backend implementation** — Prisma migration, queue ordering, claim/lease, dispatcher gating, audit, endpoints, realtime events, tests (including old-agent compatibility).

**Awaiting your review of this architecture + schema/API diff before proceeding.**

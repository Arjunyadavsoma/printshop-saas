# API — Mobile Executor / Queue v2

All endpoints under `/api/v1`. Zod-validated. Backward compatible.

## Shopkeeper endpoints (withAuth, roles: owner + staff)

### GET /shop/queue
List tasks in queue order.
**Response:** `{ tasks: QueueItem[], count: number }`

QueueItem: `{ id, orderId, fileId, status, priority, position, isHeld, executorMode, claimedByAgentId, kind, copies, colorMode, setLabel, printerId, version, lastExecutorKind, executorLabel, createdAt }`

executorLabel: "Waiting" | "Held" | "Printing on Shop PC" | "Printing on phone" | "Needs you" | "Printed"

### POST /shop/queue/reorder
**Body:** `{ taskId: uuid, beforeId?: uuid, afterId?: uuid, toTop?: boolean }`
**Response:** `{ reordered: true }`

### POST /shop/tasks/:id/priority
**Body:** `{ priority: 0 | 10 }`
**Response:** `{ updated: true }`

### POST /shop/tasks/:id/hold
No body. Sets `isHeld=true`.
**Response:** `{ held: true }`

### POST /shop/tasks/:id/release
No body. Sets `isHeld=false`.
**Response:** `{ released: true }`

### POST /shop/tasks/:id/reroute
**Body:** `{ printerId: uuid }`
**Response:** `{ rerouted: true }`

### POST /shop/tasks/:id/reprint
No body. Creates new attempt (increments attempts, resets status to queued).
**Response:** `{ reprinted: true }`

### POST /shop/printers/sync
Agent reports its printers + paths.
**Body:** `{ printers: [{ systemName, displayName, supportsColor, supportsDuplex, printerUuid?, paths: [{ kind, uri, status, capabilities }] }] }`
**Response:** `{ synced: true, printers: [{ id, merged: boolean }] }`

### PATCH /shop/printers/:id
Rename, set defaults, enable/disable, merge.
**Body:** `{ displayName?, isDefaultColor?, isDefaultBw?, enabled?, mergeWithId? }`

## Device-agent endpoints (withDeviceAuth)

### POST /agents/jobs/:id/claim (mobile only)
Atomic claim with version check.
**Precondition:** task is queued or held, unclaimed.
**Response:** `{ taskId, leaseExpiresAt, signedFileUrl, taskDetails: { kind, copies, colorMode, paperSize, duplex, taskPdfStorageKey } }`
**Errors:** 409 if already claimed/dispatched, 403 if not a mobile agent.

### POST /agents/jobs/:id/lease/renew
Extends lease by 60s. Only the claiming agent.
**Response:** `{ leaseExpiresAt }`

### POST /agents/jobs/:id/release
Returns task to queue. Only the claiming agent.
**Response:** `{ released: true }`

### POST /agents/jobs/:id/pullback
Asks PC to return the task. Creates a DeviceCommand (task.release.request).
**Response:** `{ pullback: true }` or 409 if PC already started printing.

### POST /agents/jobs/:id/status (existing, extended)
**Body (extended):** `{ status, lastError?, attempt?, ippJobId?, detail? }`
Old fields unchanged; new fields optional.

## Socket events (additive)

| Event | Payload |
|-------|---------|
| queue.updated | `{ queueVersion, shopId }` |
| task.claimed | `{ taskId, agentId, agentName, queueVersion }` |
| task.released | `{ taskId, queueVersion }` |
| task.priority.changed | `{ taskId, priority, queueVersion }` |
| task.held | `{ taskId, held, queueVersion }` |
| task.status | `{ taskId, status, queueVersion }` |
| printer.status | `{ printerId, status, queueVersion }` |
| agent.status | `{ agentId, kind, isOnline, queueVersion }` |
| device.revoked | `{ agentId, queueVersion }` |

`queueVersion` is per-shop, monotonically increasing. Clients detect gaps → refetch.

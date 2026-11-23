# Mobile Executor — API Reference

All endpoints are additive and backward compatible. Old PrintEXE builds work unchanged.

## Shopkeeper endpoints (withAuth: owner/staff)

### GET /api/v1/shop/queue
List tasks in queue order with executor labels, priority, held status, printer paths.

Response: `{ tasks: [{ id, orderId, kind, colorMode, copies, sheetCount, status, priority, isHeld, executorMode, position, claimedByAgentId, claimLeaseExpiresAt, executorLabel, printerId, printerName, ageSeconds }] }`

### POST /api/v1/shop/queue/reorder
Body: `{ taskId, beforeId?, afterId?, toTop? }`
Reorders using fractional index positioning.

### POST /api/v1/shop/tasks/:id/priority
Body: `{ priority: 0 | 10 }`
0 = normal, 10 = urgent.

### POST /api/v1/shop/tasks/:id/hold
Sets `isHeld = true`. Held tasks are never auto-dispatched.

### POST /api/v1/shop/tasks/:id/release
Sets `isHeld = false`. Task returns to the queue.

### POST /api/v1/shop/tasks/:id/reroute
Body: `{ printerId, pathId? }`
Changes the target printer for this task.

### POST /api/v1/shop/tasks/:id/reprint
Creates a new attempt. Requires explicit confirmation. Names the consequence: "This prints the pages again."

### POST /api/v1/shop/printers/sync
Body: `{ printers: [{ printerUuid?, displayName, supportsColor, supportsDuplex, paperSizes, paths: [{ kind, uri, status, capabilities }] }] }`
Agent reports its discovered printers + paths. Server merges by printerUuid.

### GET/PATCH /api/v1/shop/printers/:id
GET: printer details with paths.
PATCH: `{ displayName?, isDefaultColor?, isDefaultBw?, enabled?, mergeWithId? }`

### POST /api/v1/shop/walkin
Body: `{ files: [{ filename, mimeType, size, storageKey }], customerName?, customerPhone?, note? }`
Creates a walk-in order from phone uploads.

## Device-agent endpoints (withDeviceAuth)

### POST /api/v1/agents/jobs/:id/claim
Mobile agent claims a task. Atomic with version check.
Response: `{ leaseExpiresAt, signedFileUrl, task: { id, kind, colorMode, copies, sheetCount, paperSize, duplex } }`

### POST /api/v1/agents/jobs/:id/lease/renew
Renews the claim lease (15s heartbeat). Extends by 60s.

### POST /api/v1/agents/jobs/:id/release
Gives the task back to the queue. Clears `claimedByAgentId`.

### POST /api/v1/agents/jobs/:id/pullback
Asks the PC to return the task. Sends a DeviceCommand to the PC agent.
If PC already started → `409 Already printing on Shop PC`.

### POST /api/v1/agents/jobs/:id/status (existing, extended)
Body: `{ status, attempt?, detail?, ippJobId? }`
Extended with `attempt` (idempotency) and `ippJobId` (for IPP job tracking).
Old builds send the same body as before (without the new optional fields).

## Socket events (additive)

| Event | Payload | When |
|-------|---------|------|
| queue.updated | `{queueVersion}` | Queue order/content changed |
| task.claimed | `{taskId, agentId, agentName, queueVersion}` | Mobile claimed |
| task.released | `{taskId, queueVersion}` | Returned to queue |
| task.priority.changed | `{taskId, priority, queueVersion}` | Priority changed |
| task.held | `{taskId, held, queueVersion}` | Hold/release |
| task.status | `{taskId, status, queueVersion}` | Status update |
| printer.status | `{printerId, status, queueVersion}` | Printer state |
| agent.status | `{agentId, kind, isOnline, queueVersion}` | Agent online/offline |
| device.revoked | `{agentId, queueVersion}` | Device revoked |

`queueVersion` is monotonically increasing per shop. Clients detect gaps → refetch.

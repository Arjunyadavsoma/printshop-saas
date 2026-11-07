# PrintShop — Bidirectional Sync Protocol

> Design for synchronizing business data between the PrintShop SaaS
> backend and the PrintEXE Windows desktop client. The backend is
> authoritative; the desktop is a sync client.

**Status:** v1.0 — 2025-11-07 (design document). Implementation is Phase 5 work.
The sync endpoints described here do NOT exist yet.

---

## 1. Problem statement

The PrintShop platform needs bidirectional data flow:
- **Web → Desktop:** orders, pricing changes, shop settings, customer data created on the web must reach the desktop.
- **Desktop → Web:** walk-in orders, offline status changes, customer data created on the desktop must reach the web.

The backend (Supabase Postgres) is the single source of truth. The desktop operates as a cached client with offline capability.

---

## 2. Design principles

1. **Server-authoritative.** The backend wins conflicts. The desktop's local data is provisional until synced.
2. **Incremental.** Sync only changes since the last cursor — not full datasets.
3. **Idempotent.** Replaying the same change produces the same result.
4. **Cursor-based.** Each device maintains a sync cursor (timestamp or revision number). Pull returns changes since the cursor.
5. **Transactional.** Push changes are applied in a single transaction per batch.
6. **Tenant-scoped.** A device only sees its own shop's data.

---

## 3. Sync model

### 3.1 Cursor

Each device maintains a `syncCursor` — an ISO timestamp or monotonically-increasing revision number representing "the last point in time I synced."

**Initial cursor:** `1970-01-01T00:00:00Z` (pulls everything on first sync).

### 3.2 Revision numbers

Every model that participates in sync gets a `revision` column (`Int`, auto-incrementing via trigger or application logic). When a row is updated, `revision` increments. This enables:
- **Change detection:** `WHERE revision > ?clientCursor`
- **Conflict detection:** if the client's `baseRevision` != server's current `revision`, someone else changed it first.

### 3.3 Soft deletes

Models that support sync use `deletedAt DateTime?` instead of hard deletes. A sync pull returns `action: "delete"` for rows where `deletedAt` was set since the cursor.

### 3.4 Change tracking

Two approaches (pick one):

**Option A: Revision + updated_at (simpler)**
- Every model has `revision Int` + `updatedAt DateTime`
- Pull query: `WHERE shopId = ? AND updatedAt > ?cursor ORDER BY updatedAt LIMIT 100`
- Conflict check: compare `baseRevision` (client's copy) vs `revision` (server's current)

**Option B: Change log table (more robust)**
- A `SyncEvent` table records every change: `{id, shopId, entity, entityId, action, revision, createdAt}`
- Pull query: `SELECT * FROM SyncEvent WHERE shopId = ? AND id > ?cursor ORDER BY id LIMIT 100`
- More storage but enables point-in-time replay + compaction

**Recommendation:** Start with Option A (simpler, less schema change). Migrate to Option B if sync volume becomes high.

---

## 4. Endpoints (target — not yet implemented)

### POST /api/v1/devices/register
Register a desktop device with sync state.

```json
// Request (JWT auth — owner)
{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "deviceName": "Front Desk PC",
  "platform": "win32",
  "appVersion": "1.0.0",
  "machineId": "SHA256-of-hardware-fingerprint"
}
// Response 200
{
  "deviceId": "...",
  "syncCursor": "1970-01-01T00:00:00Z",
  "token": "device-token-for-future-auth"
}
```

### GET /api/v1/sync/pull?cursor={ISO}&limit=100
Incremental pull of changes since cursor.

```json
// Response 200
{
  "changes": [
    {
      "entity": "Order",
      "id": "uuid",
      "action": "upsert",  // or "delete"
      "data": { "id": "...", "shopId": "...", "status": "paid", "totalAmountPaise": 5000, ... },
      "revision": 42,
      "updatedAt": "2025-11-07T10:01:00Z"
    }
  ],
  "nextCursor": "2025-11-07T10:01:00Z",
  "hasMore": false
}
```

**Implementation:** for each entity type (Order, PrintFile, PrintJob, Shop, Customer, etc.):
```sql
SELECT id, *, revision, updatedAt
FROM "{entity}"
WHERE "shopId" = $1 AND "updatedAt" > $cursor
ORDER BY "updatedAt" ASC
LIMIT $limit;
```

### POST /api/v1/sync/push
Submit client-side changes.

```json
// Request (device auth)
{
  "changes": [
    {
      "entity": "Order",
      "id": "uuid",
      "action": "upsert",
      "data": { "status": "printing", "notes": "Started on desktop" },
      "clientRevision": 41,
      "baseRevision": 40  // the revision the desktop had when it made the change
    }
  ]
}
// Response 200
{
  "results": [
    {
      "id": "uuid",
      "accepted": true,
      "serverRevision": 42,
      "conflict": false
    },
    {
      "id": "uuid2",
      "accepted": false,
      "conflict": true,
      "serverRevision": 45,  // server is ahead of baseRevision 40
      "serverData": { ... }  // the current server version — client must merge
    }
  ]
}
```

### GET /api/v1/sync/status
Device sync state.

```json
// Response 200
{
  "deviceId": "...",
  "lastSyncAt": "2025-11-07T10:05:00Z",
  "serverRevision": 12345,
  "pendingPulls": 12,  // changes on server the device hasn't pulled
  "pendingPushes": 0   // changes on device not yet pushed
}
```

---

## 5. Conflict resolution

### 5.1 Last-write-wins (default)

If `baseRevision` (client) < `revision` (server), the server has a newer version. The server rejects the push and returns the current server data. The client must:
1. Merge its local changes with the server data (or discard local changes)
2. Retry the push with the updated `baseRevision`

### 5.2 Field-level merge (future)

For complex entities (Orders with multiple editable fields), field-level merge:
- Client sends `{field: newValue, baseValue: oldValue}`
- Server applies `newValue` only if `baseValue` matches the current server value

### 5.3 Manual resolution (rare)

For critical conflicts (e.g., two clients marking the same order as "collected" and "cancelled"), the server creates an `AuditLog` entry with `action: 'sync.conflict'` and the shopkeeper resolves manually.

---

## 6. Offline behavior

| Scenario | Desktop behavior |
|---|---|
| Online | Push immediately after each local change. Pull every 60s (or on realtime event). |
| Offline | Queue changes in local SQLite. Continue operating on local data. |
| Reconnect | 1. Push all queued changes. 2. Pull since last cursor. 3. Update local cursor. |
| Long offline (>24h) | Full re-sync (cursor reset to 1970) to catch up. |

---

## 7. Realtime notifications

When the server changes data, it publishes a realtime event to notify connected desktop clients:

| Event | Payload | Trigger |
|---|---|---|
| `sync.order.changed` | `{orderId, revision}` | Order updated |
| `sync.job.changed` | `{jobId, revision}` | PrintJob updated |
| `sync.shop.changed` | `{shopId, revision}` | Shop settings updated |

The desktop listens for these and triggers an immediate pull (instead of waiting for the 60s poll).

**This extends the existing socket.io event vocabulary** (currently `order.paid`, `job.dispatch`, etc.). The desktop joins the same `shop:{shopId}` room.

---

## 8. The local SQLite database (policy)

The desktop's SQLite queue is a **transit cache**, not a business database:
- **Print jobs:** downloaded from server, queued locally for printing, status reported back, purged after 7 days
- **Sync cache:** a local copy of recently-synced records for offline display
- **Write queue:** changes made offline, queued for push on reconnect

**This is allowed** (same pattern as the existing Bun/TS print-agent CLI's disk queue). The rule is: "No independent business data database" — transit caches are fine.

---

## 9. Entities to sync (priority)

| Entity | Direction | Priority | Notes |
|---|---|---|---|
| `Order` | Bidirectional | P0 | Core business record |
| `PrintFile` | Server → Desktop | P0 | File metadata (not bytes — use presigned URLs) |
| `PrintJob` | Bidirectional | P0 | Desktop reports status |
| `Shop` | Server → Desktop | P1 | Settings changes |
| `PrintAgent` | Server → Desktop | P1 | Agent list for the shop |
| `Customer` | Bidirectional | P2 | Not yet implemented (Phase 2 model) |
| `Invoice` | Bidirectional | P2 | Not yet implemented |
| `Expense` | Bidirectional | P2 | Not yet implemented |
| `AuditLog` | Server → Desktop | P3 | Read-only on desktop |

**Files (binary):** NOT synced as bytes. The desktop fetches presigned URLs from the server when needed. File metadata (storageKey, mimeType, size) IS synced.

---

## 10. Schema changes needed

To support sync, add to each synced model:
```prisma
model Order {
  // ... existing fields ...
  revision      Int      @default(1)  // NEW: increment on every update
  deletedAt     DateTime?              // NEW: soft delete
}
```

Plus new models:
```prisma
model DeviceSyncState {
  id            String   @id @default(uuid())
  shopId        String   // tenant FK
  deviceId      String   // FK → PrintAgent or a new Device table
  syncCursor    String   // ISO timestamp or revision number
  lastSyncAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([shopId, deviceId])
  @@index([shopId])
}

model SyncEvent {  // Option B only
  id            Int      @id @default(autoincrement())
  shopId        String   // tenant FK
  entity        String   // 'Order', 'PrintJob', etc.
  entityId      String
  action        String   // 'upsert' | 'delete'
  revision      Int
  createdAt     DateTime @default(now())
  @@index([shopId, createdAt])
  @@index([entity, entityId])
}
```

---

## 11. Testing

| Test | What it verifies |
|---|---|
| Pull since cursor | Returns only changes after the cursor |
| Push upsert | Creates or updates a record |
| Push conflict | Rejects when baseRevision < server revision |
| Push idempotency | Replaying the same push produces the same result |
| Soft delete | Returns `action: "delete"` for deleted records |
| Tenant isolation | Device only sees its own shop's changes |
| Offline replay | Queued pushes flush on reconnect |
| Concurrent push | Two devices pushing the same record — one wins, one conflicts |
| Large dataset | Pagination works (hasMore + nextCursor) |
| Realtime trigger | `sync.*` event triggers immediate pull |

---

## 12. Implementation status

| Component | Status |
|---|---|
| Sync endpoints | ❌ Not implemented |
| `DeviceSyncState` model | ❌ Not in schema |
| `revision` columns | ❌ Not on any model |
| `deletedAt` columns | ❌ Not on any model (hard deletes used) |
| `sync.*` realtime events | ❌ Not published |
| PrintEXE sync client | ❌ Not implemented (PrintEXE has print-job polling only) |
| Tests | ❌ None |

**This is Phase 5 work.** The design above is the target. Implementation requires:
1. Schema migration (add `revision` + `deletedAt` to synced models)
2. New `DeviceSyncState` model
3. New `/api/v1/sync/*` routes
4. Realtime event additions
5. PrintEXE sync client implementation
6. Cross-client integration tests

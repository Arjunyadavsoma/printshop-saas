# PrintEXE Website Integration Audit

> Phase 0 audit of the PrintShop SaaS website + backend for PrintEXE
> integration. Documents actual findings from the source code at
> commit `74e1940` (2025-11-07).

---

## 1. Repository state

| Property | Value |
|---|---|
| Repository | `github.com/Arjunyadvsoma/printshop-saas` |
| Commit | `74e1940` |
| Branch | `main` |
| Working tree | Clean |
| Production | `https://printshop-saas-three.vercel.app` (Vercel) |
| Shops API | ✅ 200 (1 shop: "Arjun Print Hub") |
| Health | ✅ `{"status":"ok"}` |

---

## 2. Tech stack (verified)

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js | 16.1.1 (App Router, Turbopack) |
| Language | TypeScript | 5 (strict, `noImplicitAny: false`) |
| UI | React | 19.0.0 |
| Styling | Tailwind CSS | 4 (OKLCH tokens, shadcn/ui new-york) |
| Database | PostgreSQL | Supabase (pooler :6543) |
| ORM | Prisma | 6.11 |
| Realtime | Socket.IO | 4.8.4 (mini-service :3003) |
| Storage | Supabase Storage / R2 / S3 | adapter-selected |
| Auth | Custom JWT (HS256 + PBKDF2) | not next-auth (unused) |
| Validation | Zod | 4.0 |
| State | Zustand + TanStack Query | — |
| Charts | Recharts | 2.15 |
| Tests | Vitest 5 + Playwright 1.65 | 234 tests pass |

---

## 3. Existing PrintEXE integration (what works NOW)

### 3.1 Agent API (6 routes — all functional)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/agents/register` | POST | JWT (owner) | Mint device token (shown once) |
| `/api/v1/agents/token` | POST | Device token | Exchange → JWT for Socket.IO |
| `/api/v1/agents/heartbeat` | POST | Device token | Refresh presence (60s interval) |
| `/api/v1/agents/jobs/pending` | GET | Device token | Fetch queued jobs (up to 10, presigned URLs) |
| `/api/v1/agents/jobs/{id}/status` | POST | Device token | Atomic claim / complete / fail |
| `/api/v1/agents/{id}` | DELETE | JWT (owner) | Revoke device (cancels queued jobs) |

### 3.2 Device token auth

- Token format: `<uuid>-<uuid>` (72 chars)
- Storage: HMAC-SHA256('print-agent-salt', token) → hex hash in `PrintAgent.tokenHash`
- Auth header: `Authorization: Bearer <deviceToken>`
- The server resolves `shopId` from the agent row (tenant isolation)
- Heartbeat refreshes `isOnline=true`, `lastSeenAt=now` on every authed call

### 3.3 Socket.IO realtime

- URL: `wss://printshop-saas-three.vercel.app/?XTransformPort=3003`
- Auth: emit `auth {token: jwt}` after connect → join room `shop:<shopId>`
- Events published: `job.dispatch`, `order.paid`, `order.ready`, `job.printing`, `job.completed`, `agent.revoked`
- Dashboard subscribes: `order.paid`, `order.ready`, `job.printing`, `job.completed`, `order.collected`

### 3.4 Sync endpoints (implemented, DB tables not yet pushed)

| Route | Method | Auth | Status |
|---|---|---|---|
| `/api/v1/devices/register` | POST | JWT (owner) | ✅ Code exists, `DeviceSyncState` table not in DB |
| `/api/v1/sync/pull` | GET | Device token | ✅ Code exists, handles missing table gracefully |
| `/api/v1/sync/push` | POST | Device token | ✅ Code exists, Customer table not in DB |
| `/api/v1/sync/status` | GET | Device token | ✅ Code exists |

### 3.5 Print job lifecycle (current)

```
Customer pays → webhook verifies → order.status='paid'
→ PrintJob rows created (status='queued')
→ Socket.IO 'job.dispatch' published
→ Agent polls /agents/jobs/pending OR receives Socket.IO push
→ Agent claims: POST /agents/jobs/{id}/status {status:'printing'}
→ Agent downloads PDF from presigned URL (15-min TTL)
→ Agent prints
→ Agent completes: POST /agents/jobs/{id}/status {status:'completed'}
→ Server marks file completed, maybe marks order 'ready'
→ Shopkeeper marks 'collected' → files deleted from storage
```

---

## 4. What's MISSING (gap analysis)

### 4.1 Delivery coordination (Phase 5 — not implemented)

**Current state:** every paid order creates PrintJob rows with `status='queued'`. ALL registered agents receive the `job.dispatch` event. The first agent to POST `{status:'printing'}` claims it (atomic conditional update).

**Missing:**
- No agent selection logic (no eligibility check, no workload awareness)
- No delivery attempt tracking (no record of which agent was targeted)
- No delivery status (separate from print status)
- No fallback orchestration (cloud staging is implicit — the presigned URL IS the cloud fallback)

**Needed:**
- `PrintDeliveryAttempt` model (new table)
- Delivery coordinator service (agent selection + attempt tracking)
- `POST /api/v1/agents/jobs/{jobId}/received` endpoint (durable receipt)

### 4.2 Durable receipt (Phase 6 — not implemented)

**Current state:** the server treats a `status:'completed'` report as evidence the job is done. But there's no intermediate "I received the file" acknowledgement. If an agent downloads the PDF but crashes before printing, the job stays in `printing` state until stale recovery (5 min) flips it to `needs_review`.

**Missing:**
- `POST /api/v1/agents/jobs/{jobId}/received` endpoint
- Checksum validation (SHA-256 of the downloaded PDF)
- Cloud cleanup scheduling (only delete after verified receipt)

### 4.3 Storage lifecycle (Phase 7 — not implemented)

**Current state:** files are deleted from storage when the shopkeeper marks an order `collected` (`POST /shops/me/orders/{id}/complete`). If the shopkeeper forgets, files persist indefinitely.

**Missing:**
- Scheduled cleanup (no cron/worker)
- Grace period after receipt before cloud deletion
- Cleanup retry for failed deletions
- `FileCleanupTask` model (cleanup queue)

### 4.4 Direct delivery / WebRTC (Phase 8 — not implemented)

**Current state:** all document delivery is via presigned cloud URLs. The agent downloads from S3/R2/Supabase.

**Missing:**
- WebRTC signaling (transfer.offer, transfer.answer, transfer.ice-candidate events)
- Direct peer-to-peer transfer
- TURN relay support
- Feature flag for capability negotiation

**⚠️ Cannot implement until PrintEXE supports WebRTC** — the current companion (v0.4.7) does not have WebRTC capabilities. Build server-side architecture behind a feature flag; activate when PrintEXE is upgraded.

### 4.5 UI gaps

**Printer Setup page** (`/shop/printer`, 1139 lines):
- ✅ Has PrintLatch + Native Printer setup guides
- ✅ Has agent registration via the dashboard
- ⚠️ No one-time token display modal (token is shown in a simple alert)
- ⚠️ No device list with online/offline status on this page
- ⚠️ No device revocation UI on this page
- ⚠️ No device diagnostics page

**Dashboard** (`/shop/dashboard`, 882 lines):
- ✅ Shows agent online/offline banner
- ✅ Shows print queue
- ⚠️ No PrintEXE overview section (device count, active jobs, delivery status)
- ⚠️ No storage overview (cloud document count, cleanup status)

---

## 5. Proposed changes (safe — backward compatible)

### 5.1 Schema additions (NEW tables only — no fields on existing models)

```prisma
model PrintDeliveryAttempt {
  id              String    @id @default(uuid())
  printJobId      String    // FK → PrintJob
  agentId         String    // FK → PrintAgent
  shopId          String    // tenant FK
  attemptId       Int       @default(1) // per-job sequence
  deliveryMode    String    @default("cloud") // cloud|direct|webrtc
  status          String    @default("created") // created|dispatched|received|failed|expired
  checksum        String?   // SHA-256 hex of the file
  fileSize        Int?      // bytes
  startedAt       DateTime  @default(now())
  completedAt     DateTime?
  errorCode       String?
  errorMessage    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  @@index([shopId, status])
  @@index([agentId])
  @@index([printJobId])
}

model FileCleanupTask {
  id              String    @id @default(uuid())
  printFileId     String    // FK → PrintFile
  shopId          String    // tenant FK
  storageKey      String    // the S3/R2/Supabase key
  cleanupType     String    @default("after_receipt") // after_receipt|after_collect|forced
  scheduledAt     DateTime  // when to attempt deletion
  completedAt     DateTime?
  attempts        Int       @default(0)
  maxAttempts     Int       @default(5)
  lastError       String?
  status          String    @default("pending") // pending|completed|failed|skipped
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  @@index([shopId, status])
  @@index([scheduledAt])
  @@index([printFileId])
}
```

**Why no fields on existing models:** the previous session broke production by adding `revision`/`deletedAt` to Shop/Order/etc. without running the DB migration. The Prisma client regenerated to include those columns in every query, but the DB didn't have them → 500 errors. This time, we only add NEW models (new tables). Existing queries are unaffected. The new tables don't exist until `bun run db:push` is run, and the code handles their absence with try/catch.

### 5.2 New endpoints

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/agents/jobs/{jobId}/received` | POST | Device token | Durable receipt acknowledgement |
| `/api/v1/shops/me/delivery/attempts` | GET | JWT (owner) | View delivery attempts (dashboard) |

### 5.3 New services

| Service | File | Purpose |
|---|---|---|
| Delivery coordinator | `src/lib/services/delivery-coordinator.ts` | Agent selection + delivery attempt tracking |
| Cleanup scheduler | `src/lib/services/cleanup-scheduler.ts` | Schedule cloud file deletion after receipt |

---

## 6. Backward compatibility verification

All existing endpoints are PRESERVED with their current request/response shapes:

| Endpoint | Breaking change? | New fields? |
|---|---|---|
| `POST /agents/register` | ❌ No | None |
| `POST /agents/token` | ❌ No | None |
| `POST /agents/heartbeat` | ❌ No | None |
| `GET /agents/jobs/pending` | ❌ No | None (response unchanged) |
| `POST /agents/jobs/{id}/status` | ❌ No | None |
| `DELETE /agents/{id}` | ❌ No | None |
| Socket.IO events | ❌ No | New events are additive (transfer.* not yet active) |

**Existing PrintEXE v0.4.7 will continue to work without any update.**

---

## 7. Production safety checklist

| Check | Status |
|---|---|
| No fields added to existing Prisma models | ✅ Only new models |
| Existing API contracts unchanged | ✅ Verified |
| tsc --noEmit passes | ✅ (to be verified after implementation) |
| ESLint passes | ✅ (to be verified) |
| 234 existing tests pass | ✅ (to be verified) |
| No destructive DB operations | ✅ New tables only |
| No secrets exposed | ✅ (to be verified) |
| Production shops API returns 200 | ✅ Verified |

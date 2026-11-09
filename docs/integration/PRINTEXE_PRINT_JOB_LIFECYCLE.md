# PrintEXE Print Job Lifecycle

> How a print job moves from order-paid to file-deleted. Source of truth:
> `src/app/api/v1/agents/jobs/pending/route.ts`, `.../[id]/status/route.ts`,
> `.../[id]/received/route.ts`,
> `src/lib/services/delivery-coordinator.ts` (`dispatchDelivery`,
> `markDeliveryReceived`, `processCleanupTasks`),
> `src/lib/services/durable-queue.ts` (`STALE_THRESHOLD_MS = 5*60*1000`,
> `recoverStaleJobs`),
> `src/app/api/v1/cron/cleanup/route.ts`,
> `src/lib/repositories/print-job.repository.ts` (`PrintJobRepository`).

A `PrintJob` is a row in the `PrintJob` table. It is created by the server when
an order transitions to `paid`, claimed by an agent via an atomic conditional
update, and ends in one of three terminal states: `completed`, `failed`, or
`needs_review` (stale recovery). The PDF file itself lives in cloud storage
(R2/S3/Supabase) and is delivered to PrintEXE via a presigned URL.

---

## 1. State machine

```
queued ──[POST /jobs/{id}/status {status:'printing'}: atomic
          UPDATE WHERE id AND status='queued']──▶ printing
                                                      │
                ┌─────────────────┬───────────────────┤
                ▼                 ▼                   ▼
       {status:          {status:           startedAt > 5 min
        'completed'}      'failed',          (cron worker)
        atomic WHERE      lastError}              │
        status='printing' unconditional            ▼
                │                 │          ┌───────────────┐
                ▼                 ▼          │ needs_review  │
          ┌───────────┐    ┌────────┐       │ (manual only) │
          │ completed │    │ failed │       └───────────────┘
          └───────────┘    └────────┘
                │
                ▼
        file.status='completed'
        order→'ready' when ALL files completed
```

States stored as `PrintJob.status` (lowercase). `PrintFile.status` tracks in
parallel: `pending` → `queued` → `printing` → `completed` (or `failed` /
`needs_review`).

---

## 2. Job creation (server side, NOT a PrintEXE concern)

When a payment webhook verifies an order's payment, the print service:

1. For each `PrintFile` in the paid order, calls
   `PrintJobRepository.create({shopId, fileId})`. The row starts as
   `status='queued', agentId=null, attempts=0, queuedAt=NOW()`.
2. Calls `dispatchDelivery(...)` in the delivery coordinator — this creates a
   `PrintDeliveryAttempt` row (`status='dispatched'` if an agent is online,
   `status='created'` if none) and publishes the `job.dispatch` Socket.IO event.
3. If no agent is online, the job sits in `queued` — agents will discover it via
   `GET /agents/jobs/pending` polling.

PrintEXE does not create jobs. The server is the single writer for `PrintJob`
creation.

---

## 3. Dispatch (Socket.IO event OR polling)

### 3.1 Socket.IO path (preferred)

The server publishes to room `shop:<shopId>`:
```json
{"event":"job.dispatch",
 "payload":{"jobId":"...","fileId":"...","orderId":"...","filename":"invoice.pdf",
   "downloadUrl":"https://r2.dev/...?sig=...",
   "copies":2,"colorMode":"bw","duplex":false,"paperSize":"a4","pageRange":null,
   "deliveryAttemptId":"uuid"}}
```

The event reaches ALL agents connected to that shop's room — first one to claim
wins (§4 below). The `deliveryAttemptId` should be echoed back in the receipt
call (§6) for traceability.

### 3.2 Polling fallback (every 2 s when Socket.IO disconnected)

```
GET /api/v1/agents/jobs/pending
Authorization: Bearer <deviceToken>
```

Returns up to **10** queued jobs (oldest first by `queuedAt`):
```json
{"success":true,"data":{"jobs":[
  {"jobId":"...","fileId":"...","orderId":"...","filename":"invoice.pdf",
   "downloadUrl":"https://...","copies":2,"colorMode":"bw","duplex":false,
   "paperSize":"a4","pageRange":null}],
 "agentId":"..."}}
```

The polling endpoint ALSO publishes `agent.heartbeat` realtime event to the shop
channel — so the dashboard sees the agent as "polling" even if no Socket.IO
connection is open.

### 3.3 Important: do NOT print on receipt of the event alone

The `job.dispatch` event and the `/jobs/pending` response are HINTS, not
authorizations. PrintEXE MUST download the PDF, then atomically CLAIM the job
(§4) before sending it to the printer. Otherwise two agents could both print
the same job.

---

## 4. Claim — `POST /agents/jobs/{jobId}/status` with `{status:'printing'}`

This is the **atomic conditional update** that makes concurrent claims safe:

```sql
UPDATE "PrintJob"
SET status='printing', "agentId"=$1, "startedAt"=NOW()
WHERE id=$2 AND shopId=$3 AND status='queued';
```

Only one concurrent agent's update affects a row (Postgres row-level locking).
The "loser" gets 0 rows updated.

**Response (winner):** `{"success":true,"data":{"jobId":"...","status":"printing","applied":true}}`
**Response (loser):** `{"success":true,"data":{"jobId":"...","skipped":true,"reason":"job is 'printing' — already claimed by another agent"}}`

Note that the loser response is still HTTP 200 with `success:true` — `skipped`
is in the `data`, NOT an error. PrintEXE should treat `data.skipped === true` as
"move on to the next pending job."

Side effects on a successful claim:
- `PrintFile.status → 'printing'`.
- Publishes `job.printing` realtime event.

---

## 5. Download (presigned URL, 15-min TTL)

The `downloadUrl` is a presigned storage URL from `getPresignedDownloadUrl(storageKey, 900)` — TTL is 900 s (15 min). Fetch with a plain HTTP GET (NO `Authorization` header — the signature is in the URL query). R2/S3/Supabase return absolute URLs; the in-memory dev adapter returns a relative path the server prepends with `APP_BASE_URL`. Set the HTTP client timeout to 5 minutes for large PDFs.

After download, optionally compute SHA-256 (`SHA256.Create().ComputeHashAsync`) — the server doesn't currently compute a hash on upload, so the receipt endpoint accepts the agent's reported checksum for audit purposes only (future enhancement; see `received/route.ts` line 105–111).

---

## 6. Receipt — `POST /agents/jobs/{jobId}/received` (v0.5.x ONLY)

Called AFTER PrintEXE has downloaded the PDF and verified it persisted locally.
A DURABLE acknowledgement separate from the status report (§7) — receipt means
"I have the file," status means "I'm printing it / I finished printing it."

```json
POST /api/v1/agents/jobs/{jobId}/received
Authorization: Bearer <deviceToken>
{"deliveryAttemptId":"uuid-from-job.dispatch","checksum":"<sha256-hex>","fileSize":123456}
```

Server (`agents/jobs/[id]/received/route.ts`):
1. `findByIdAndShop(jobId, shopId)` — tenant check. Not found → 404.
2. If `job.status ∈ {'completed','failed'}` → `{received:true, cleanupScheduled:false, message:"Job is already '<status>'. Receipt not needed."}` (idempotent short-circuit).
3. If a `PrintDeliveryAttempt` with `status='received'` already exists → `{received:true, cleanupScheduled:true, message:"Receipt already acknowledged (idempotent)..."}`.
4. Else `markDeliveryReceived(...)` — marks the latest attempt `received`, records `checksum` + `fileSize` + `completedAt`, **schedules a `FileCleanupTask`** with `scheduledAt = now + 15 min`, publishes `delivery.received`, writes `AuditLog` (`action:'delivery.received'`).

**Response 200:** `{"success":true,"data":{"jobId":"...","received":true,"cleanupScheduled":true,"message":"Receipt acknowledged. Cloud cleanup scheduled for 2025-11-07T10:15:00Z."}}`

**v0.4.7 clients:** this endpoint did not exist — PrintEXE 0.4.x MUST NOT call it (returns 404).

---

## 7. Printing → completion / failure — `POST /agents/jobs/{jobId}/status`

After the file is downloaded (and receipt acknowledged on v0.5.x), PrintEXE prints the PDF (SumatraPDF / Windows spooler / PrintLatch).

**On success:** `{"status":"completed"}`. Server: conditional update WHERE `status='printing'`. If 0 rows → `{skipped:true, reason:"...duplicate ack or already completed"}`. On success: `PrintFile.status → 'completed'`, `printedAt = NOW()`, publishes `job.completed`, then `maybeMarkOrderReady(fileId, shopId)` — if ALL files in the order are now `completed`, the order transitions to `ready` and `order.ready` is published.

**On failure:** `{"status":"failed","lastError":"paper jam on tray 2"}`. Server: unconditional `UPDATE PrintJob SET status='failed', lastError=$1`. `PrintFile.status → 'failed'`. Publishes `job.failed`.

The `lastError` field is `z.string().max(500)` — keep messages short and structured (`"printer_offline"`, `"paper_jam"`, `"out_of_ink"`), not full stack traces.

---

## 8. Stale recovery — 5-minute threshold → `needs_review`

`src/lib/services/durable-queue.ts` defines `STALE_THRESHOLD_MS = 5 * 60 * 1000` and `recoverStaleJobs(shopId?)`. Invoked on worker restart (not a continuous cron): any job in `printing` status whose `startedAt` is older than 5 minutes is moved to `needs_review` — **NOT** back to `queued`. This prevents automatic duplicate printing when the previous worker might have printed but failed to ACK; a shopkeeper must manually review and either re-queue or mark completed.

When recovery fires:
1. `UPDATE PrintJob SET status='needs_review' WHERE status='printing' AND startedAt < NOW() - INTERVAL '5 minutes'`.
2. `PrintFile.status → 'needs_review'` (best-effort; file may have been auto-deleted).
3. Publishes `job.needs_review` realtime event per recovered job.

**PrintEXE should listen for `job.needs_review` events** for jobs it currently believes it is printing — if the server moved one of "its" jobs to `needs_review`, stop trying to print/report status on it. Any further `POST /jobs/{id}/status` calls on a `needs_review` job return `{skipped:true, reason:"job is 'needs_review' — ..."}`. The shopkeeper resolves `needs_review` via `requeueJob` or `markJobCompleted` (in `durable-queue.ts`) — not PrintEXE.

---

## 9. Cleanup scheduling (15-minute grace after receipt)

When `POST /jobs/{jobId}/received` succeeds, the delivery coordinator schedules a `FileCleanupTask`:
```ts
const gracePeriodMs = 15 * 60 * 1000;
await db.fileCleanupTask.create({ data: {
  printFileId, shopId, storageKey, cleanupType:'after_receipt',
  scheduledAt: new Date(now + gracePeriodMs), status:'pending' }});
```

A Vercel Cron job hits `GET /api/v1/cron/cleanup` every 5 minutes (configured in `vercel.json`). The cron handler authenticates with `Authorization: Bearer ${CRON_SECRET}` (or `?secret=`) and calls `processCleanupTasks(limit)` — finds `FileCleanupTask` rows with `status='pending' AND scheduledAt <= NOW()`, takes up to `limit` (default 10, max 50). For each: `storage.head(storageKey)` — if missing, mark `completed` (idempotent no-op); else `storage.deleteMany([storageKey])` and mark `completed`. Failures bump `attempts`; once `attempts >= maxAttempts`, the task is marked `failed` (operator must intervene).

**PrintEXE doesn't invoke cleanup directly.** But the cleanup scheduling means that after a successful receipt, the `downloadUrl` becomes invalid in 15 minutes — if PrintEXE needs to reprint (e.g., paper jam after a successful receipt), it must call `GET /agents/jobs/pending` again to get a fresh presigned URL.

---

## 10. End-to-end timelines

**Happy path:**
```
T+0    Customer pays → webhook verifies → order.status='paid'
T+1s   Server creates PrintJob {status:'queued'}, publishes job.dispatch
T+2s   PrintEXE receives dispatch (or polls /jobs/pending), starts download
T+5s   Download complete + SHA-256 computed locally
T+5s   POST /jobs/{id}/received (v0.5.x) → cleanup scheduled at T+15:05
T+5s   POST /jobs/{id}/status {status:'printing'} → atomic claim succeeds
T+5s   PDF sent to Windows spooler
T+45s  Print complete → POST /jobs/{id}/status {status:'completed'}
       Server: file.status='completed', publishes job.completed + order.ready
T+15m  Cron processes FileCleanupTask → deletes the PDF from cloud storage
```

Receipt (`T+5s`) is BEFORE the print completion (`T+45s`). This is intentional:
receipt means "I have the file durably; you can schedule cloud deletion," NOT "I have printed it." Print status is reported separately so a printer failure after receipt does NOT trigger cloud deletion prematurely — the 15-minute grace covers most printer stalls. For longer prints, the operator re-fetches a fresh `downloadUrl` from `/jobs/pending` (presigned URLs are regenerated on every poll).

**Failure path (paper jam):**
```
T+0    job.dispatch received
T+3s   Download complete + receipt ACK'd
T+3s   POST /jobs/{id}/status {status:'printing'} → claim OK
T+30s  Paper jam detected
T+31s  POST /jobs/{id}/status {status:'failed', lastError:'paper_jam_tray_2'}
       Server: PrintJob + PrintFile → 'failed', publishes job.failed
T+31s  Dashboard shows the job as failed; shopkeeper clears the jam
       + clicks "Re-queue" → durable-queue.requeueJob → status='queued', agentId=null
T+33s  Next pending-jobs poll picks up the re-queued job → cycle restarts
```

The cloud cleanup task scheduled at T+15:03 still fires, but `requeueJob` doesn't touch the storage key — the file is still there. PrintEXE's re-download uses the original URL (still valid for 15 min from T+3s) or a fresh `downloadUrl` from the next `/jobs/pending` response.

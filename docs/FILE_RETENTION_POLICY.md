# File Retention Policy

> How long files live in cloud storage and on PrintEXE's local disk.
> When they're deleted. What happens when deletion fails.

**Status:** v1.0 — 2025-11-07.

---

## 1. Principle

**Cloud storage is temporary. Business records are permanent.**

PDFs are large, privacy-sensitive, and only needed during the active order lifecycle. They should be deleted as soon as they're no longer needed. But order metadata, payment records, and audit logs must persist indefinitely.

---

## 2. Cloud storage lifecycle

```
Upload → cloud_available → (receipt confirmed) → cloud_delete_pending (15 min grace) → cloud_deleted
```

| Stage | Duration | Trigger |
|---|---|---|
| `cloud_available` | Until receipt + grace period | File uploaded by customer |
| `cloud_delete_pending` | 15 minutes (grace period) | PrintEXE confirms durable receipt |
| `cloud_deleted` | Permanent | Cleanup worker deletes the object |

### 2.1 Grace period

**15 minutes after verified receipt.**

Why 15 minutes:
- Long enough for PrintEXE to start printing (even if the queue is busy)
- Long enough for a human to notice if something went wrong
- Short enough to minimize privacy exposure + storage costs

The grace period is configurable in the delivery coordinator:
```typescript
const gracePeriodMs = 15 * 60 * 1000; // 15 minutes
```

### 2.2 Hard delete trigger

Files are ALSO deleted when the shopkeeper marks an order `collected`:
- `POST /api/v1/shops/me/orders/{id}/complete`
- This deletes ALL files in the order from storage immediately (no grace period)
- The business records (Order, PrintFile metadata, PaymentAttempt) remain

### 2.3 What is NOT deleted

When a PDF is deleted from cloud storage, these records REMAIN:
- `Order` row (status, total, payment info, timestamps)
- `PrintFile` row (filename, page count, print settings, price — but NOT the file itself)
- `PrintJob` row (status, timing, agent)
- `PaymentAttempt` + `PaymentEvent` rows (transaction records)
- `AuditLog` entries (full audit trail)

**The shopkeeper can always see "Customer ordered 10 B&W A4 pages, paid ₹20, printed on 2025-11-07" even after the PDF is deleted.**

---

## 3. Cleanup worker

**Location:** `src/lib/services/delivery-coordinator.ts` → `processCleanupTasks()`

### 3.1 How it works

1. Finds `FileCleanupTask` rows where `status='pending'` AND `scheduledAt <= now`
2. For each task:
   a. Check if the storage object exists (`storage.head(key)`)
   b. If not exists → mark task `completed` (already deleted)
   c. If exists → delete (`storage.deleteMany([key])`)
   d. Mark task `completed` or `failed`
3. On failure: increment `attempts`, set `lastError`, mark `failed` if `attempts >= maxAttempts`

### 3.2 Retry policy

- `maxAttempts`: 5 (default)
- Exponential backoff NOT built in (the worker runs on a cron, so each run is a retry)
- After `maxAttempts` exhausted → `status='failed'`, requires manual intervention

### 3.3 Idempotency

- If the object is already deleted (404), the task is marked `completed`
- If the task is already `completed`, it's not processed again
- Duplicate tasks for the same file → the `printFileId` index helps detect duplicates

---

## 4. Deployment: running the cleanup worker

### 4.1 The problem with Vercel serverless

Vercel serverless functions have a **maximum execution time** (10s on Hobby plan, 60s on Pro). A cleanup worker that processes many files cannot run as a single function call.

### 4.2 Solution: external cron

Use an external cron service to call a cleanup endpoint periodically:

**Option A: Vercel Cron (recommended)**
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/v1/cron/cleanup",
    "schedule": "*/5 * * * *"
  }]
}
```
This calls `GET /api/v1/cron/cleanup` every 5 minutes. The endpoint calls `processCleanupTasks(10)`.

**Option B: GitHub Actions**
```yaml
on:
  schedule:
    - cron: '*/5 * * * *'
jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X GET https://printshop-saas-three.vercel.app/api/v1/cron/cleanup
```

**Option C: Render cron worker**
Deploy the realtime mini-service (which is already on Render) with an additional cron job.

### 4.3 The cleanup cron endpoint (not yet implemented)

```typescript
// src/app/api/v1/cron/cleanup/route.ts
export async function GET(req: Request) {
  // Verify authorization (CRON_SECRET or admin key)
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await processCleanupTasks(10);
  return Response.json({ success: true, data: result });
}
```

---

## 5. PrintEXE local retention

PrintEXE manages its own local file retention. The website does NOT control this.

### 5.1 Recommended local policy

| File type | Local retention | Location |
|---|---|---|
| Downloaded PDFs (print cache) | Delete after printing completes | `%TEMP%\PrintShop\Companion\pdfs\{jobId}.pdf` |
| Completed job metadata | Purge after 7 days | Local SQLite queue |
| Failed job metadata | Purge after 30 days | Local SQLite queue |
| Device token | Permanent (until revoked) | DPAPI-encrypted `%AppData%\PrintShop\Companion\device.dat` |
| Logs | 14-day rolling | `%AppData%\PrintShop\Companion\logs\` |

### 5.2 The website's role

The website tells PrintEXE:
- "Print this file" (via `job.dispatch` or `/agents/jobs/pending`)
- "I acknowledge your receipt" (via the `/received` response)
- "The job is completed/cancelled" (via the shopkeeper's actions)

The website does NOT tell PrintEXE when to delete local files. That's PrintEXE's responsibility.

---

## 6. Privacy + compliance

### 6.1 Customer files

- Customer PDFs are stored in cloud storage ONLY during the active order lifecycle
- After `collected` or after `receipt + 15 min grace`, the PDF is deleted
- The `PrintFile.storageKey` remains in the DB but the object is gone
- No one can download a deleted file (presigned URL returns 404)

### 6.2 Audit trail

- `AuditLog` records WHO accessed WHAT WHEN
- `delivery.received` is logged with agent ID + checksum
- `file.deleted` is NOT currently logged (the cleanup worker doesn't audit deletions — this is a gap)
- Audit logs are pruned after 30 days (container startup maintenance)

### 6.3 Data residency

- Cloud storage: Supabase (AWS ap-southeast-1, Singapore) or R2 (Cloudflare)
- Database: Supabase Postgres (ap-southeast-1)
- All data stays in Asia-Pacific region

---

## 7. Edge cases

| Scenario | Behavior |
|---|---|
| File uploaded but order never paid | File stays in cloud indefinitely. No cleanup task created (no receipt). Shopkeeper can cancel the order → files deleted. |
| File uploaded, paid, but agent never comes online | File stays in cloud. No receipt → no cleanup. Shopkeeper can mark `collected` → files deleted. |
| File deleted from cloud but PrintEXE tries to download | Presigned URL returns 404. PrintEXE reports `failed`. Shopkeeper can cancel or the customer re-uploads. |
| Cleanup worker fails to delete (storage error) | Task retried on next cron run. After 5 attempts → `failed`. Requires manual investigation. |
| Two cleanup tasks for the same file | First one deletes the object. Second one finds it missing → marks `completed`. No error. |
| Shopkeeper marks `collected` while cleanup task is pending | The `complete` endpoint deletes the file immediately. The cleanup task finds it missing → marks `completed`. |

---

## 8. Configuration

| Setting | Default | Location |
|---|---|---|
| Grace period after receipt | 15 minutes | `delivery-coordinator.ts:gracePeriodMs` |
| Max cleanup attempts | 5 | `FileCleanupTask.maxAttempts` |
| Cleanup batch size | 10 | `processCleanupTasks(maxTasks=10)` |
| Cron schedule | Every 5 minutes | `vercel.json` (not yet added) |
| Audit log retention | 30 days | `container.ts:recoverStaleJobsOnStartup` |
| Stale print job threshold | 5 minutes | `durable-queue.ts:STALE_THRESHOLD` |

---

## 9. Monitoring

The cleanup worker returns:
```json
{ "processed": 10, "completed": 8, "failed": 1, "skipped": 1 }
```

Monitor for:
- `failed` > 0 → storage issues (check Supabase/R2/S3 credentials + quota)
- `processed` = 0 for extended periods → cron not running
- Tasks stuck in `pending` for >1 hour → cron not running or `scheduledAt` is in the future

---

## 10. Implementation status

| Component | Status |
|---|---|
| `FileCleanupTask` model | ✅ In schema |
| `processCleanupTasks()` function | ✅ Implemented |
| Grace period scheduling | ✅ Implemented (in `markDeliveryReceived`) |
| Cleanup cron endpoint | ❌ Not yet implemented (`/api/v1/cron/cleanup`) |
| `vercel.json` cron config | ❌ Not yet added |
| `file.deleted` audit logging | ❌ Gap (cleanup worker doesn't audit) |
| Local retention (PrintEXE side) | ❌ PrintEXE responsibility |

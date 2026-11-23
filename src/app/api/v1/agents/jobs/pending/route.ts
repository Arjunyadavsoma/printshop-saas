import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok, fail } from '@/lib/api/envelope';
import { AppError } from '@platform/core/errors';
import { shopChannel } from '@platform/core/interfaces';
import { getDispatchableTasks } from '@/lib/dispatch/dispatcher-gate';

interface PendingJob {
  jobId: string;
  fileId: string;
  orderId: string;
  filename: string;
  downloadUrl: string;
  copies: number;
  colorMode: string;
  duplex: boolean;
  paperSize: string;
  pageRange: string | null;
  /** B-010: server-side SHA-256 hex for pre-print verification (null when unavailable). */
  pdfSha256: string | null;
}

/** Machine-readable per-job failure record (Phase 3 §4 / P2-1). */
interface FailedJob {
  jobId: string;
  fileId: string | null;
  /** One of: DOCUMENT_MISSING | JOB_INVALID | STORAGE_UNAVAILABLE */
  code: string;
  /** Operator/device-actionable message — NEVER provider internals. */
  message: string;
}

/**
 * Resolve a presigned storage URL to a fully-qualified download URL.
 * Storage adapters return EITHER an absolute URL (Supabase/R2/S3 presigned
 * — `https://...`) OR a relative path (the in-memory dev adapter —
 * `/api/v1/storage/get?...`). Concatenating `${base}${url}` unconditionally
 * produces broken URLs like `https://vercel.apphttps://r2.dev/...` on
 * production storage adapters. This helper only prepends the base for
 * relative paths.
 */
function resolveDownloadUrl(presignedUrl: string, base: string): string {
  if (/^https?:\/\//i.test(presignedUrl)) return presignedUrl; // already absolute
  if (presignedUrl.startsWith('/')) return `${base}${presignedUrl}`;
  return `${base}/${presignedUrl}`;
}

const logger = () => getContainer().logger;

/**
 * GET /api/v1/agents/jobs/pending — device-token-authed. Returns queued jobs
 * for the agent's shop, each with a presigned download URL + print settings.
 * The agent claims a job by POSTing /agents/jobs/:id/status {status:'printing'}.
 *
 * PHASE 3 (P2-1) — the endpoint no longer 500s (or silently returns an empty
 * list) when storage presigning fails. Every job is prepared independently:
 *   - a job whose document cannot be presigned is reported in `failedJobs`
 *     with a machine-readable code, and is NOT marked consumed — it stays
 *     queued and will be offered again once storage recovers;
 *   - jobs that prepared fine are still returned (one unavailable document
 *     does not corrupt unrelated jobs);
 *   - if NO job could be prepared but queued jobs exist, the response is a
 *     documented 503 envelope with code STORAGE_UNAVAILABLE so the device
 *     can back off and retry instead of seeing a fake "nothing to do".
 * Provider error details go to the server log only — never in the response.
 */
export const GET = withDeviceAuth(async (_req, _ctx, { agent, shopId }) => {
  const container = getContainer();
  // Dispatcher gate: only AUTO tasks that are not held, not already claimed,
  // and whose target printer has a WINDOWS_QUEUE path from a live PC agent.
  // Tasks parked by the shopkeeper or claimed by a mobile agent are silently
  // excluded — old PrintEXE builds see no change in the response shape.
  const queued = await getDispatchableTasks(shopId, 10);
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const jobs: PendingJob[] = [];
  const failedJobs: FailedJob[] = [];

  for (const j of queued) {
    // The job is already shop-scoped via findQueuedByShop; look the file up by id.
    const file = await container.db.findOne<{ id: string; orderId: string; originalFilename: string; storageKey: string; copies: number; colorMode: string; duplex: boolean; paperSize: string; pageRange: string | null; sha256: string | null }>('printFile', { id: j.fileId });
    if (!file) {
      // The document row is gone; the job cannot ever be delivered in this
      // form. Report it (never silently skipped) — the shopkeeper sees the
      // document-missing job in the print-jobs view and can resolve it.
      failedJobs.push({
        jobId: j.id,
        fileId: j.fileId,
        code: 'DOCUMENT_MISSING',
        message: 'The document for this job no longer exists. Ask the shop operator to resolve the job.',
      });
      continue;
    }
    if (!file.storageKey) {
      failedJobs.push({
        jobId: j.id,
        fileId: file.id,
        code: 'JOB_INVALID',
        message: 'The document for this job has no stored file to download.',
      });
      continue;
    }
    try {
      const downloadUrl = resolveDownloadUrl(
        await container.storage.getPresignedDownloadUrl(file.storageKey, 900),
        base,
      );
      jobs.push({
        jobId: j.id,
        fileId: file.id,
        orderId: file.orderId,
        filename: file.originalFilename,
        downloadUrl,
        copies: file.copies,
        colorMode: file.colorMode,
        duplex: file.duplex,
        paperSize: file.paperSize,
        pageRange: file.pageRange,
        // B-010: server-side SHA-256 (null when the storage adapter can't
        // expose bytes) so the companion verifies the download BEFORE printing.
        pdfSha256: file.sha256 ?? null,
      });
    } catch (cause) {
      // Presign failure: storage misconfiguration, expired/invalid provider
      // credentials, provider outage, or a missing object. The internal
      // cause is logged server-side only; the response carries a stable,
      // machine-readable code with NO provider details.
      logger().error('agents/jobs/pending: presign failed — job left queued for retry', {
        jobId: j.id,
        fileId: file.id,
        storageProvider: process.env.STORAGE_PROVIDER ?? 'unset',
        error: cause instanceof Error ? cause.message : String(cause),
      });
      failedJobs.push({
        jobId: j.id,
        fileId: file.id,
        code: 'STORAGE_UNAVAILABLE',
        message: 'The document store is temporarily unavailable — this job stays queued and will be offered again.',
      });
    }
  }

  // Presence ping so the dashboard sees the agent polling.
  void container.realtime.publish(shopChannel(shopId), 'agent.heartbeat', { agentId: agent.id }).catch(() => {});

  const storageUnavailable = failedJobs.some((f) => f.code === 'STORAGE_UNAVAILABLE');
  if (jobs.length === 0 && failedJobs.length > 0 && storageUnavailable) {
    // Every queued job failed to prepare for a STORAGE reason: do NOT pretend
    // the queue is empty. 503 + STORAGE_UNAVAILABLE is safe to retry with
    // backoff. The per-job failure records ride in error.details — no
    // provider internals. (Document-missing / job-invalid failures return
    // 200 with failedJobs below: the queue itself is healthy, the individual
    // jobs are permanently undeliverable until an operator resolves them.)
    return fail(new AppError(
      `${failedJobs.length} queued job(s) could not be prepared — storage unavailable`,
      'STORAGE_UNAVAILABLE',
      503,
      { jobs, failedJobs, agentId: agent.id, retryable: true },
    ));
  }
  return ok({ jobs, failedJobs, agentId: agent.id });
});

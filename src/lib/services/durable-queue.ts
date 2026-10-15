import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import type { PrintJob, PrintJobStatus } from '@platform/core/domain';

/**
 * Database-backed durable print queue.
 *
 * Uses the existing `printJob` Prisma table for persistence. Job claiming
 * is atomic via a conditional UPDATE (WHERE status = 'queued' → status =
 * 'printing'). This prevents two workers from claiming the same job.
 *
 * Recovery: on app restart, call `recoverStaleJobs()` to move any job stuck
 * in 'printing' (started but never completed — e.g. the worker crashed) back
 * to 'queued' if the startedAt is older than the stale threshold. This is
 * idempotent — a job that's already 'completed' is never touched.
 *
 * Duplicate-printing prevention: a job in 'completed' status is never
 * re-claimed (the atomic WHERE clause excludes it). If an ack is lost
 * (the worker printed but the network failed before reporting 'completed'),
 * the recovery picks it up — but only if it's still 'printing' (not yet
 * 'completed'). If the worker already reported 'completed' but the ack
 * was lost, the job stays 'completed' (no duplicate print).
 */

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Atomically claim a queued job: UPDATE printJob SET status='printing',
 * agentId=? WHERE id=? AND status='queued'. Returns true if claimed.
 *
 * This is the "first-claim-wins" semantics — two concurrent workers calling
 * this will not both succeed (only one UPDATE affects a row).
 */
export async function claimJob(jobId: string, agentId: string): Promise<boolean> {
  const db = getContainer().db;
  // Find the job first.
  const job = await db.findOne<PrintJob & { id: string; status: string; shopId: string }>('printJob', { id: jobId });
  if (!job) return false;
  if (job.status !== 'queued') return false; // already claimed or done
  // Atomically transition queued → printing.
  const updated = await db.update<{ status: string; agentId: string; startedAt: Date }>(
    'printJob',
    { id: jobId, status: 'queued' }, // WHERE: id AND status='queued'
    { status: 'printing', agentId, startedAt: new Date() },
  );
  return updated.length > 0;
}

/**
 * Mark a job as completed (idempotent — calling twice is a no-op).
 */
export async function completeJob(jobId: string): Promise<void> {
  const db = getContainer().db;
  await db.update('printJob', { id: jobId, status: 'printing' }, { status: 'completed', completedAt: new Date() });
}

/**
 * Mark a job as failed with an error message (idempotent).
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const db = getContainer().db;
  await db.update('printJob', { id: jobId }, { status: 'failed', lastError: error });
}

/**
 * Recover stale jobs after a restart: any job in 'printing' status whose
 * startedAt is older than STALE_THRESHOLD_MS is moved back to 'queued'.
 * This lets a new worker pick it up. Jobs already 'completed' are untouched.
 *
 * If the previous worker actually printed the file but crashed before
 * reporting 'completed', this will re-queue it — the new worker will print
 * again (a duplicate). To prevent this, the recovery should be MANUAL (a
 * shopkeeper reviews stale jobs and marks them completed or re-queues).
 * For now, we auto-requeue with a warning log.
 */
export async function recoverStaleJobs(shopId?: string): Promise<number> {
  const db = getContainer().db;
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  // Find stale 'printing' jobs.
  const filter: Record<string, unknown> = { status: 'printing' };
  if (shopId) filter.shopId = shopId;
  const stale = await db.findMany<{ id: string; startedAt: Date | null; shopId: string }>(
    'printJob',
    filter,
    { limit: 50 },
  );
  let recovered = 0;
  for (const job of stale) {
    if (job.startedAt && job.startedAt < cutoff) {
      // Move back to queued for a new worker to claim.
      await db.update('printJob', { id: job.id }, { status: 'queued', agentId: null, startedAt: null });
      recovered++;
    }
  }
  if (recovered > 0) {
    getContainer().logger.warn('durable-queue: recovered stale jobs', { count: recovered, shopId });
  }
  return recovered;
}

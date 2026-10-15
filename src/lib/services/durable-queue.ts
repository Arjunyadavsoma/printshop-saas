import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';

/**
 * Database-backed durable print queue.
 *
 * The "queue" IS the `printJob` Prisma table. Jobs are created with
 * `status='queued'`. An agent claims a job via `POST /agents/jobs/:id/status`
 * (which enforces the state machine: queued→printing→completed|failed).
 *
 * This module provides:
 *  - `recoverStaleJobs()`: called on startup. Moves jobs stuck in 'printing'
 *    (worker crashed) to `needs_review` — NOT back to 'queued'. This prevents
 *    automatic duplicate printing when the previous worker might have
 *    printed but failed to acknowledge. A shopkeeper must manually review
 *    and either mark the job completed or re-queue it.
 *  - `requeueJob()`: manual re-queue from `needs_review` → `queued`
 *    (shopkeeper confirms the job was NOT printed and should be retried).
 *  - `markCompleted()`: manual completion from `needs_review` (shopkeeper
 *    confirms the job WAS printed by the crashed worker).
 */

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Recover stale jobs after a restart: any job in 'printing' status whose
 * startedAt is older than STALE_THRESHOLD_MS is moved to `needs_review`.
 * This is NOT an automatic re-queue — the shopkeeper must review whether
 * the file was actually printed before re-queuing.
 *
 * @returns count of jobs moved to needs_review
 */
export async function recoverStaleJobs(shopId?: string): Promise<number> {
  const db = getContainer().db;
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const filter: Record<string, unknown> = { status: 'printing' };
  if (shopId) filter.shopId = shopId;
  const stale = await db.findMany<{ id: string; startedAt: Date | null; shopId: string; fileId: string }>(
    'printJob',
    filter,
    { limit: 50 },
  );
  let recovered = 0;
  for (const job of stale) {
    if (job.startedAt && job.startedAt < cutoff) {
      // Move to needs_review — NOT queued. Prevents duplicate printing.
      await db.update('printJob', { id: job.id }, { status: 'needs_review' });
      // Best-effort: update the file status too (file may have been auto-deleted).
      try {
        await repos.files.update(job.fileId, { status: 'needs_review' });
      } catch {
        // File was deleted (24h auto-delete) — the job is still recovered.
      }
      recovered++;
    }
  }
  if (recovered > 0) {
    getContainer().logger.warn('durable-queue: moved stale jobs to needs_review', { count: recovered, shopId });
    // Publish a realtime event so the dashboard shows the needs_review state.
    const { shopChannel } = await import('@platform/core/interfaces');
    for (const job of stale) {
      if (job.startedAt && job.startedAt < cutoff) {
        void getContainer().realtime.publish(shopChannel(job.shopId), 'job.needs_review', { jobId: job.id, fileId: job.fileId });
      }
    }
  }
  return recovered;
}

/**
 * Manual re-queue from needs_review → queued (shopkeeper confirms NOT printed).
 */
export async function requeueJob(jobId: string, shopId: string): Promise<void> {
  const db = getContainer().db;
  await db.update('printJob', { id: jobId, shopId, status: 'needs_review' }, { status: 'queued', agentId: null, startedAt: null });
}

/**
 * Manual completion from needs_review → completed (shopkeeper confirms printed).
 */
export async function markJobCompleted(jobId: string, shopId: string, fileId: string): Promise<void> {
  const db = getContainer().db;
  await db.update('printJob', { id: jobId, shopId, status: 'needs_review' }, { status: 'completed', completedAt: new Date() });
  await repos.files.update(fileId, { status: 'completed', printedAt: new Date() });
}

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { db } from '@/lib/db';
import { shopChannel } from '@platform/core/interfaces';

/**
 * Delivery Coordinator — decides how a print job's PDF reaches a PrintEXE device.
 *
 * Current delivery mode: **cloud staging** (presigned URL).
 * The PDF is stored in cloud storage (R2/S3/Supabase). The agent downloads it
 * via a presigned URL from `GET /agents/jobs/pending` or the `job.dispatch`
 * Socket.IO event.
 *
 * Future delivery mode: **direct WebRTC transfer** (feature-flagged, not active
 * until PrintEXE supports it — see docs/DIRECT_TRANSFER_PROTOCOL.md).
 *
 * The coordinator:
 * 1. Finds eligible agents for the shop (online, not revoked)
 * 2. Creates a PrintDeliveryAttempt record
 * 3. Publishes `job.dispatch` via Socket.IO
 * 4. If no agent online → the job stays in `queued` state; agents poll for it
 *
 * Delivery states (tracked in PrintDeliveryAttempt.status):
 *   created → dispatched → received → (cleanup scheduled)
 *                      → failed → (retry or cloud fallback)
 *                      → expired → (stale, re-dispatch)
 */

const STALE_THRESHOLD_SECONDS = 30;

export interface DeliveryDispatchResult {
  attemptId: string;
  agentId: string | null;
  deliveryMode: 'cloud' | 'direct' | 'webrtc';
  dispatched: boolean;
  reason?: string;
}

/**
 * Find eligible agents for a shop (online + heartbeat fresh).
 */
export async function findEligibleAgents(shopId: string): Promise<Array<{
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: Date | null;
  printerName: string | null;
}>> {
  const agents = await repos.printAgents.listByShop(shopId);
  const now = Date.now();
  return agents.filter((a) => {
    if (!a.lastSeenAt) return false;
    const ageSeconds = (now - a.lastSeenAt.getTime()) / 1000;
    return ageSeconds <= STALE_THRESHOLD_SECONDS;
  });
}

/**
 * Create a delivery attempt record for a print job.
 * Called after a PrintJob is created (order paid → file enqueued).
 *
 * If an eligible agent is found, dispatch via Socket.IO immediately.
 * If no agent is online, the job stays queued — agents poll /jobs/pending.
 */
export async function dispatchDelivery(
  printJobId: string,
  shopId: string,
  fileId: string,
  filename: string,
  downloadUrl: string,
  jobSettings: {
    copies: number;
    colorMode: string;
    duplex: boolean;
    paperSize: string;
    pageRange: string | null;
  },
): Promise<DeliveryDispatchResult> {
  const container = getContainer();
  const channel = shopChannel(shopId);

  // Find eligible agents
  const eligible = await findEligibleAgents(shopId);
  const targetAgent = eligible[0] ?? null; // first eligible (future: workload-aware)

  // Create a delivery attempt record (in the PrintDeliveryAttempt table)
  // Wrapped in try/catch — the table may not exist until db:push is run
  let attemptId = crypto.randomUUID();
  try {
    const attempt = await (db as any).printDeliveryAttempt.create({
      data: {
        id: attemptId,
        printJobId,
        agentId: targetAgent?.id ?? 'unassigned',
        shopId,
        attemptId: 1,
        deliveryMode: 'cloud', // current mode
        status: targetAgent ? 'dispatched' : 'created',
        startedAt: new Date(),
      },
    });
    attemptId = attempt.id;
  } catch {
    // Table doesn't exist yet — continue without persistence (graceful degradation)
    try { getContainer().logger.warn('delivery-coordinator: PrintDeliveryAttempt table not available', { printJobId }); } catch { /* noop */ }
  }

  // Publish job.dispatch via Socket.IO — this reaches ALL connected agents
  // for this shop. The first agent to POST {status:'printing'} claims it.
  // This is the EXISTING behavior (preserved for backward compatibility).
  if (targetAgent || eligible.length === 0) {
    // Even if no agent is online right now, publish the event —
    // a reconnecting agent will receive it on connect (via /jobs/pending poll)
    void container.realtime.publish(channel, 'job.dispatch', {
      jobId: printJobId,
      fileId,
      orderId: undefined, // the caller can include this if available
      filename,
      downloadUrl,
      copies: jobSettings.copies,
      colorMode: jobSettings.colorMode,
      duplex: jobSettings.duplex,
      paperSize: jobSettings.paperSize,
      pageRange: jobSettings.pageRange,
      deliveryAttemptId: attemptId,
    }).catch(() => { /* best-effort */ });
  }

  return {
    attemptId,
    agentId: targetAgent?.id ?? null,
    deliveryMode: 'cloud',
    dispatched: !!targetAgent,
    reason: targetAgent ? undefined : 'no eligible agent online — job queued for polling',
  };
}

/**
 * Mark a delivery attempt as received (called by the receipt endpoint).
 * Schedules cloud cleanup after the grace period.
 */
export async function markDeliveryReceived(
  printJobId: string,
  agentId: string,
  shopId: string,
  receipt: {
    deliveryAttemptId?: string;
    checksum?: string;
    fileSize?: number;
    receivedAt?: string;
  },
): Promise<{ success: boolean; cleanupScheduled: boolean; message: string }> {
  const now = new Date();
  const gracePeriodMs = 15 * 60 * 1000; // 15 minutes
  const cleanupScheduledAt = new Date(now.getTime() + gracePeriodMs);

  // Update the delivery attempt
  try {
    // Find the latest attempt for this job
    const attempts = await (db as any).printDeliveryAttempt.findMany({
      where: { printJobId, shopId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (attempts.length > 0) {
      const attempt = attempts[0];
      // Idempotent: if already received, return success
      if (attempt.status === 'received') {
        return {
          success: true,
          cleanupScheduled: true,
          message: 'Receipt already acknowledged (idempotent).',
        };
      }

      await (db as any).printDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'received',
          agentId, // update to the actual receiving agent
          checksum: receipt.checksum ?? null,
          fileSize: receipt.fileSize ?? null,
          completedAt: receipt.receivedAt ? new Date(receipt.receivedAt) : now,
        },
      });

      // Schedule cloud cleanup — find the file's storage key
      const file = await getContainer().db.findOne<{ storageKey: string }>('printFile', {
        id: (await getContainer().db.findOne<{ fileId: string }>('printJob', { id: printJobId }))?.fileId,
      });

      if (file?.storageKey) {
        try {
          await (db as any).fileCleanupTask.create({
            data: {
              id: crypto.randomUUID(),
              printFileId: (await getContainer().db.findOne<{ fileId: string }>('printJob', { id: printJobId }))?.fileId ?? '',
              shopId,
              storageKey: file.storageKey,
              cleanupType: 'after_receipt',
              scheduledAt: cleanupScheduledAt,
              status: 'pending',
            },
          });
          try { getContainer().logger.info('delivery-coordinator: cloud cleanup scheduled', { printJobId, scheduledAt: cleanupScheduledAt.toISOString() }); } catch { /* noop */ }
          return {
            success: true,
            cleanupScheduled: true,
            message: `Receipt acknowledged. Cloud cleanup scheduled for ${cleanupScheduledAt.toISOString()}.`,
          };
        } catch {
          // FileCleanupTask table may not exist — skip cleanup scheduling
          return {
            success: true,
            cleanupScheduled: false,
            message: 'Receipt acknowledged. Cloud cleanup scheduling unavailable (table not migrated).',
          };
        }
      }

      return {
        success: true,
        cleanupScheduled: false,
        message: 'Receipt acknowledged. File storage key not found for cleanup.',
      };
    }
  } catch {
    // Tables don't exist — graceful degradation
  }

  return {
    success: true,
    cleanupScheduled: false,
    message: 'Receipt acknowledged (delivery tracking table not available).',
  };
}

/**
 * Process pending cleanup tasks (called by a cron or scheduled endpoint).
 * Deletes files from cloud storage whose scheduledAt has passed.
 *
 * ⚠️ On Vercel serverless, this should be called by an external cron
 * (e.g. Vercel Cron, GitHub Actions, or Render cron). It cannot run
 * as a long-lived worker inside a serverless function.
 */
export async function processCleanupTasks(maxTasks = 10): Promise<{
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
}> {
  const now = new Date();
  const container = getContainer();
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const tasks = await (db as any).fileCleanupTask.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: maxTasks,
    });

    for (const task of tasks) {
      try {
        // Check if the storage object still exists
        const exists = await container.storage.head(task.storageKey);
        if (!exists) {
          // Already deleted — mark as completed
          await (db as any).fileCleanupTask.update({
            where: { id: task.id },
            data: { status: 'completed', completedAt: now, attempts: task.attempts + 1 },
          });
          completed++;
          continue;
        }

        // Delete the object
        await container.storage.deleteMany([task.storageKey]);

        await (db as any).fileCleanupTask.update({
          where: { id: task.id },
          data: { status: 'completed', completedAt: now, attempts: task.attempts + 1 },
        });
        completed++;
        try { container.logger.info('cleanup: file deleted', { storageKey: task.storageKey, taskId: task.id }); } catch { /* noop */ }
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        await (db as any).fileCleanupTask.update({
          where: { id: task.id },
          data: {
            attempts: task.attempts + 1,
            lastError: errorMsg,
            status: task.attempts + 1 >= task.maxAttempts ? 'failed' : 'pending',
          },
        });
        try { container.logger.error('cleanup: deletion failed', { taskId: task.id, error: errorMsg }); } catch { /* noop */ }
      }
    }

    return { processed: tasks.length, completed, failed, skipped };
  } catch {
    // FileCleanupTask table doesn't exist
    return { processed: 0, completed: 0, failed: 0, skipped: 0 };
  }
}

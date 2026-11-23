import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
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

  // Look up the orderId from the PrintFile so the job.dispatch event
  // includes it — the companion needs orderId for its local queue.
  // (Phase 4: via the container adapter, not the raw Prisma client —
  // tests register an in-memory container and must observe these writes.)
  let orderId: string | undefined;
  try {
    const file = await container.db.findOne<{ orderId: string }>('printFile', { id: fileId });
    orderId = file?.orderId;
  } catch { /* graceful degradation */ }

  // Create a delivery attempt record (in the PrintDeliveryAttempt table)
  // Wrapped in try/catch — the table may not exist until migrations have run
  let attemptId = crypto.randomUUID();
  try {
    const attempt = await container.db.insert<{ id: string }>('printDeliveryAttempt', {
      id: attemptId,
      printJobId,
      agentId: targetAgent?.id ?? 'unassigned',
      shopId,
      attemptId: 1,
      deliveryMode: 'cloud', // current mode
      status: targetAgent ? 'dispatched' : 'created',
      startedAt: new Date(),
    });
    attemptId = attempt.id;
  } catch {
    // Table doesn't exist yet — continue without persistence (graceful degradation)
    try { container.logger.warn('delivery-coordinator: PrintDeliveryAttempt table not available', { printJobId }); } catch { /* noop */ }
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
      orderId: orderId, // resolved from PrintFile.orderId — companion needs this
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
    /** B-010: set when the agent's checksum disagrees with the server-side hash. */
    errorCode?: string | null;
  },
): Promise<{ success: boolean; cleanupScheduled: boolean; message: string }> {
  const now = new Date();
  const gracePeriodMs = 15 * 60 * 1000; // 15 minutes
  const cleanupScheduledAt = new Date(now.getTime() + gracePeriodMs);

  // Update the delivery attempt
  try {
    const cdb = getContainer().db;
    // Find the latest attempt for this job (Phase 4: via the container
    // adapter — the raw Prisma client bypassed test containers entirely,
    // which is why the cleanup tests could silently read the REAL database).
    const attempts = await cdb.findMany<{ id: string; status: string; errorCode: string | null }>(
      'printDeliveryAttempt',
      { printJobId, shopId },
      { order: ['createdAt', 'desc'], limit: 1 },
    );

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

      await cdb.update('printDeliveryAttempt', { id: attempt.id }, {
        status: 'received',
        agentId, // update to the actual receiving agent
        checksum: receipt.checksum ?? null,
        fileSize: receipt.fileSize ?? null,
        errorCode: receipt.errorCode ?? attempt.errorCode ?? null,
        completedAt: receipt.receivedAt ? new Date(receipt.receivedAt) : now,
      });

      // Schedule cloud cleanup — find the file's storage key
      const file = await getContainer().db.findOne<{ storageKey: string }>('printFile', {
        id: (await getContainer().db.findOne<{ fileId: string }>('printJob', { id: printJobId }))?.fileId,
      });

      if (file?.storageKey) {
        try {
          await cdb.insert('fileCleanupTask', {
            id: crypto.randomUUID(),
            printFileId: (await getContainer().db.findOne<{ fileId: string }>('printJob', { id: printJobId }))?.fileId ?? '',
            shopId,
            storageKey: file.storageKey,
            cleanupType: 'after_receipt',
            scheduledAt: cleanupScheduledAt,
            status: 'pending',
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

    // Phase-3 fix (P2-7/P2-8 root cause): attempts were only ever CREATED by
    // the realtime-push dispatch path (dispatchToAgents). The companion's
    // actual pull-mode flow — GET /agents/jobs/pending → claim → /received —
    // never created a row, so markDeliveryReceived fell through to the
    // silent "table not available" success below and the delivery history /
    // customer delivery status stayed empty forever. Now the receipt
    // CREATES the durable attempt row it just as honestly reports.
    const priorAttempts = (await cdb.findMany<unknown>('printDeliveryAttempt', { printJobId, shopId })).length;
    await cdb.insert('printDeliveryAttempt', {
      id: crypto.randomUUID(),
      printJobId,
      agentId,
      shopId,
      attemptId: priorAttempts + 1,
      deliveryMode: 'cloud',
      status: 'received',
      checksum: receipt.checksum ?? null,
      fileSize: receipt.fileSize ?? null,
      errorCode: receipt.errorCode ?? null,
      startedAt: now,
      completedAt: receipt.receivedAt ? new Date(receipt.receivedAt) : now,
    });

    // Same cleanup scheduling as the update path (best-effort).
    try {
      const file = await getContainer().db.findOne<{ storageKey: string }>('printFile', {
        id: (await getContainer().db.findOne<{ fileId: string }>('printJob', { id: printJobId }))?.fileId,
      });
      if (file?.storageKey) {
        await cdb.insert('fileCleanupTask', {
          id: crypto.randomUUID(),
          printFileId: (await getContainer().db.findOne<{ fileId: string }>('printJob', { id: printJobId }))?.fileId ?? '',
          shopId,
          storageKey: file.storageKey,
          cleanupType: 'after_receipt',
          scheduledAt: cleanupScheduledAt,
          status: 'pending',
        });
        return { success: true, cleanupScheduled: true, message: 'Receipt acknowledged. Cloud cleanup scheduled.' };
      }
    } catch { /* cleanup table may not exist — receipt is still recorded */ }

    return {
      success: true,
      cleanupScheduled: false,
      message: 'Receipt acknowledged (created delivery attempt row).',
    };
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
 * P9-Security §7 — schedule a FORCED cleanup for a sensitive document.
 *
 * Sensitive documents (Aadhaar, PAN, ID copies) the customer marked as
 * sensitive must be deleted from cloud storage RIGHT AFTER printing — not
 * the usual 15-min grace period (`after_receipt`) or the 24h post-pickup
 * sweep (`after_collect`). The privacy contract is: the moment the last
 * page leaves the printer, the file is gone from the server.
 *
 * This helper creates a `forced` FileCleanupTask with `scheduledAt = now`
 * so the next cron tick of /api/v1/cron/cleanup deletes it (typically
 * within 5 minutes — the cron is the GitHub-Actions scheduler). For
 * environments where the cron is not yet wired, the opportunistic sweep
 * in `processCleanupTasks` will pick it up the next time ANY cleanup task
 * is processed.
 *
 * Idempotency: the cron's `processCleanupTasks` handles a missing storage
 * object gracefully (marks the task completed). Calling this helper twice
 * for the same file is safe — it creates two tasks; the first one deletes
 * the blob, the second one is a no-op.
 *
 * @param fileId      The PrintFile whose storage object should be deleted.
 * @param shopId      The shop that owns the file (tenant scope).
 * @param storageKey  The cloud-storage key for the file's ORIGINAL bytes
 *                    (NOT the normalized PDF — the original carries the
 *                    raw upload with potential EXIF / metadata).
 */
export async function scheduleForcedCleanupForFile(
  fileId: string,
  shopId: string,
  storageKey: string,
): Promise<{ scheduled: boolean; taskId: string | null }> {
  const now = new Date();
  const container = getContainer();
  try {
    const task = await container.db.insert<{ id: string }>('fileCleanupTask', {
      id: crypto.randomUUID(),
      printFileId: fileId,
      shopId,
      storageKey,
      cleanupType: 'forced',
      scheduledAt: now,
      status: 'pending',
    });
    try {
      container.logger.info('cleanup: forced cleanup scheduled for sensitive file', {
        fileId, shopId, scheduledAt: now.toISOString(),
      });
    } catch { /* noop */ }
    return { scheduled: true, taskId: task.id };
  } catch (err) {
    // The FileCleanupTask table may not exist yet on a fresh deploy (it's
    // added by a migration). Don't crash the caller — the next deploy that
    // has the table will start scheduling forced cleanups. Log the failure
    // so the operator sees it.
    try {
      container.logger.error('cleanup: failed to schedule forced cleanup', {
        fileId, shopId, error: err instanceof Error ? err.message : String(err),
      });
    } catch { /* noop */ }
    return { scheduled: false, taskId: null };
  }
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
    // Phase 4: container adapter (raw client bypassed test containers and
    // silently read the shared dev DB — the cleanup tests passed only while
    // that DB had no pending tasks). The adapter's filter is strict-equality,
    // so the due-time comparison happens in JS.
    const pending = await getContainer().db.findMany<{ id: string; storageKey: string; attempts: number; maxAttempts: number; scheduledAt: Date }>(
      'fileCleanupTask',
      { status: 'pending' },
      { order: ['scheduledAt', 'asc'], limit: maxTasks * 4 },
    );
    const tasks = pending.filter((t) => new Date(t.scheduledAt).getTime() <= now.getTime()).slice(0, maxTasks);

    for (const task of tasks) {
      try {
        // Check if the storage object still exists
        const exists = await container.storage.head(task.storageKey);
        if (!exists) {
          // Already deleted — mark as completed
          await getContainer().db.update('fileCleanupTask', { id: task.id }, { status: 'completed', completedAt: now, attempts: task.attempts + 1 });
          completed++;
          continue;
        }

        // Delete the object
        await container.storage.deleteMany([task.storageKey]);

        await getContainer().db.update('fileCleanupTask', { id: task.id }, { status: 'completed', completedAt: now, attempts: task.attempts + 1 });
        completed++;
        try { container.logger.info('cleanup: file deleted', { storageKey: task.storageKey, taskId: task.id }); } catch { /* noop */ }
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        await getContainer().db.update('fileCleanupTask', { id: task.id }, {
          attempts: task.attempts + 1,
          lastError: errorMsg,
          status: task.attempts + 1 >= task.maxAttempts ? 'failed' : 'pending',
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

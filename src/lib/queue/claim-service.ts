/**
 * Claim/lease service — atomic task claiming with optimistic concurrency.
 *
 * Rules:
 * - A MOBILE agent may CLAIM only while task is PENDING (queued) or HELD.
 * - Claim = atomic UPDATE with version check; exactly one claimer wins.
 * - Claim sets a lease (60s, renewed by 15s heartbeats).
 * - Lease expiry before PRINTED → status UNCERTAIN (never auto-retry).
 * - "Pull back from PC": allowed only if PC reports not-yet-started.
 */

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { AppError, NotFoundError, ForbiddenError } from '@platform/core/errors';

const LEASE_DURATION_MS = 60 * 1000; // 60 seconds
const LEASE_RENEW_MS = 60 * 1000; // extend by 60s on renewal

export interface ClaimResult {
  taskId: string;
  leaseExpiresAt: string;
  signedFileUrl: string;
  taskDetails: {
    kind: string | null;
    copies: number | null;
    colorMode: string | null;
    paperSize: string | null;
    duplex: boolean | null;
    taskPdfStorageKey: string | null;
  };
}

/**
 * Atomically claim a task for a mobile agent.
 * Uses optimistic concurrency: UPDATE ... WHERE version = expected.
 * Exactly one claimer wins — the version check guarantees it.
 */
export async function claimTask(taskId: string, agentId: string): Promise<ClaimResult> {
  const db = getContainer().db;

  // Load the task
  const task = await db.findOne('PrintJob', { id: taskId });
  if (!task) throw new NotFoundError('Task not found');

  const t = task as Record<string, unknown>;
  const status = t.status as string;
  const isHeld = t.isHeld as boolean;
  const claimedBy = t.claimedByAgentId as string | null;
  const version = t.version as number;

  // Precondition: task must be queued or held
  if (status !== 'queued' && !(status === 'queued' && isHeld)) {
    if (status === 'dispatched' || status === 'printing') {
      throw new ForbiddenError('Task is already being printed on the Shop PC');
    }
    if (status === 'completed') {
      throw new ForbiddenError('Task is already printed');
    }
    throw new ForbiddenError(`Task status '${status}' cannot be claimed`);
  }

  // Already claimed?
  if (claimedBy && claimedBy !== agentId) {
    throw new ForbiddenError('Task is already claimed by another device');
  }

  // Atomic claim: UPDATE with version check
  // This ensures exactly one winner if two agents race
  const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS);
  const updated = await db.update('PrintJob',
    { id: taskId, version },
    {
      claimedByAgentId: agentId,
      claimLeaseExpiresAt: leaseExpiresAt,
      version: version + 1,
      lastExecutorKind: 'MOBILE',
      status: 'dispatched', // mark as dispatched so PC doesn't pick it up
    }
  );

  if (!updated || (Array.isArray(updated) && updated.length === 0)) {
    // Version mismatch — someone else won the race
    throw new ForbiddenError('Task was modified by another action. Refresh and try again.');
  }

  // Generate signed file URL (short expiry, order-bound)
  const container = getContainer();
  const taskPdfKey = t.taskPdfStorageKey as string | null;
  let signedFileUrl = '';
  if (taskPdfKey) {
    try {
      signedFileUrl = taskPdfKey; // return the storage key; the client gets a signed URL separately
    } catch { /* best-effort */ }
  }

  // Audit
  try {
    await repos.audit.log({
      shopId: t.shopId as string,
      action: 'queue.claim',
      entityType: 'PrintJob',
      entityId: taskId,
      metadata: { agentId, version: version + 1 },
    });
  } catch { /* best-effort */ }

  return {
    taskId,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    signedFileUrl,
    taskDetails: {
      kind: (t.kind as string) ?? null,
      copies: (t.copies as number) ?? null,
      colorMode: (t.colorMode as string) ?? null,
      paperSize: (t.paperSize as string) ?? null,
      duplex: (t.duplex as boolean) ?? null,
      taskPdfStorageKey: taskPdfKey,
    },
  };
}

/** Renew the claim lease (called by the mobile agent every 15s while printing). */
export async function renewLease(taskId: string, agentId: string): Promise<{ leaseExpiresAt: string }> {
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId });
  if (!task) throw new NotFoundError('Task not found');

  const t = task as Record<string, unknown>;
  if (t.claimedByAgentId !== agentId) {
    throw new ForbiddenError('Only the claiming agent can renew the lease');
  }

  const newExpiry = new Date(Date.now() + LEASE_RENEW_MS);
  await db.update('PrintJob', { id: taskId }, { claimLeaseExpiresAt: newExpiry });

  return { leaseExpiresAt: newExpiry.toISOString() };
}

/** Release the claim — return the task to the queue. */
export async function releaseClaim(taskId: string, agentId: string): Promise<void> {
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId });
  if (!task) throw new NotFoundError('Task not found');

  const t = task as Record<string, unknown>;
  if (t.claimedByAgentId !== agentId) {
    throw new ForbiddenError('Only the claiming agent can release the claim');
  }

  await db.update('PrintJob', { id: taskId }, {
    claimedByAgentId: null,
    claimLeaseExpiresAt: null,
    status: 'queued', // back to queue
    version: (t.version as number) + 1,
  });

  try {
    await repos.audit.log({
      shopId: t.shopId as string,
      action: 'queue.release',
      entityType: 'PrintJob',
      entityId: taskId,
      metadata: { agentId },
    });
  } catch { /* best-effort */ }
}

/**
 * Check for expired leases — called by a cron job.
 * If a lease expired without a PRINTED status → set UNCERTAIN.
 * NEVER auto-retries.
 */
export async function checkLeaseExpiry(): Promise<number> {
  const db = getContainer().db;
  const now = new Date();

  // Find tasks where lease expired and status is not completed
  const tasks = await db.findMany('PrintJob', {
    claimLeaseExpiresAt: { lt: now },
    status: { in: ['dispatched', 'printing'] },
  });

  let count = 0;
  for (const task of tasks) {
    const t = task as Record<string, unknown>;
    await db.update('PrintJob', { id: t.id }, {
      status: 'uncertain',
      lastError: 'Lease expired without print confirmation',
      version: (t.version as number) + 1,
    });
    count++;

    try {
      await repos.audit.log({
        shopId: t.shopId as string,
        action: 'queue.lease_expired',
        entityType: 'PrintJob',
        entityId: t.id as string,
        metadata: { agentId: t.claimedByAgentId },
      });
    } catch { /* best-effort */ }
  }

  return count;
}

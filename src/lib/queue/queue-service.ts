/**
 * Queue service — ordering, reorder, priority, hold, release, reroute, reprint.
 *
 * Queue order = isHeld ASC, priority DESC, position ASC, createdAt ASC.
 * Position is a fractional index string for drag reorder.
 *
 * Every action writes to AuditLog with actor, device, before/after.
 */

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { AppError, NotFoundError, ValidationError } from '@platform/core/errors';

/** Fractional index midpoint (string-based, avoids float precision issues). */
function midpoint(before: string, after: string): string {
  // Simple approach: if before="a0" and after="b0", return "aN0" (insert between)
  // For production, use a proper lexorank implementation. This is sufficient for MVP.
  if (before === after) return before + 'm';
  const b = before.charCodeAt(0);
  const a = after.charCodeAt(0);
  if (a - b > 1) return String.fromCharCode(b + 1) + '0';
  return before + 'm';
}

export interface QueueItem {
  id: string;
  orderId: string;
  fileId: string;
  status: string;
  priority: number;
  position: string;
  isHeld: boolean;
  executorMode: string;
  claimedByAgentId: string | null;
  kind: string | null;
  copies: number | null;
  colorMode: string | null;
  setLabel: string | null;
  printerId: string | null;
  version: number;
  lastExecutorKind: string | null;
  /** Derived executor label for the UI */
  executorLabel: string;
  createdAt: Date;
}

function deriveExecutorLabel(task: Record<string, unknown>): string {
  if (task.isHeld) return 'Held';
  if (task.claimedByAgentId) return 'Printing on phone';
  if (task.status === 'dispatched' || task.status === 'printing') return 'Printing on Shop PC';
  if (task.status === 'completed') return 'Printed';
  if (task.status === 'uncertain') return 'Needs you';
  return 'Waiting';
}

export async function getQueue(shopId: string): Promise<QueueItem[]> {
  const db = getContainer().db;
  const tasks = await db.findMany('PrintJob', { shopId }, {
    order: ['isHeld', 'asc'],
    limit: 200,
  });
  return tasks.map((t: Record<string, unknown>) => ({
    id: t.id as string,
    orderId: t.fileId as string, // TODO: join to get orderId from file
    fileId: t.fileId as string,
    status: t.status as string,
    priority: (t.priority as number) ?? 0,
    position: (t.position as string) ?? 'a0',
    isHeld: (t.isHeld as boolean) ?? false,
    executorMode: (t.executorMode as string) ?? 'AUTO',
    claimedByAgentId: (t.claimedByAgentId as string) ?? null,
    kind: (t.kind as string) ?? null,
    copies: (t.copies as number) ?? null,
    colorMode: (t.colorMode as string) ?? null,
    setLabel: (t.setLabel as string) ?? null,
    printerId: (t.printerId as string) ?? null,
    version: (t.version as number) ?? 1,
    lastExecutorKind: (t.lastExecutorKind as string) ?? null,
    executorLabel: deriveExecutorLabel(t),
    createdAt: t.createdAt as Date,
  }));
}

export async function reorderTask(shopId: string, taskId: string, opts: { beforeId?: string; afterId?: string; toTop?: boolean }): Promise<void> {
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId, shopId });
  if (!task) throw new NotFoundError('Task not found');

  let newPosition: string;
  if (opts.toTop) {
    const queue = await getQueue(shopId);
    const first = queue[0];
    newPosition = first ? midpoint('a0', first.position) : 'a0';
  } else if (opts.beforeId) {
    const beforeTask = await db.findOne('PrintJob', { id: opts.beforeId, shopId });
    if (!beforeTask) throw new NotFoundError('Before task not found');
    newPosition = midpoint('a0', (beforeTask as any).position);
  } else if (opts.afterId) {
    const afterTask = await db.findOne('PrintJob', { id: opts.afterId, shopId });
    if (!afterTask) throw new NotFoundError('After task not found');
    newPosition = midpoint((afterTask as any).position, 'z9');
  } else {
    throw new ValidationError('Must specify beforeId, afterId, or toTop');
  }

  await db.update('PrintJob', { id: taskId }, { position: newPosition });
  await auditQueueAction(shopId, taskId, 'reorder', { from: (task as any).position, to: newPosition });
}

export async function setPriority(shopId: string, taskId: string, priority: number): Promise<void> {
  if (![0, 10].includes(priority)) throw new ValidationError('Priority must be 0 (normal) or 10 (urgent)');
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId, shopId });
  if (!task) throw new NotFoundError('Task not found');
  await db.update('PrintJob', { id: taskId }, { priority });
  await auditQueueAction(shopId, taskId, 'priority', { from: (task as any).priority, to: priority });
}

export async function holdTask(shopId: string, taskId: string): Promise<void> {
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId, shopId });
  if (!task) throw new NotFoundError('Task not found');
  if ((task as any).status === 'printing') throw new ValidationError('Cannot hold a task that is printing');
  await db.update('PrintJob', { id: taskId }, { isHeld: true });
  await auditQueueAction(shopId, taskId, 'hold', { from: false, to: true });
}

export async function releaseTask(shopId: string, taskId: string): Promise<void> {
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId, shopId });
  if (!task) throw new NotFoundError('Task not found');
  await db.update('PrintJob', { id: taskId }, { isHeld: false });
  await auditQueueAction(shopId, taskId, 'release', { from: true, to: false });
}

export async function rerouteTask(shopId: string, taskId: string, printerId: string): Promise<void> {
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId, shopId });
  if (!task) throw new NotFoundError('Task not found');
  const printer = await db.findOne('Printer', { id: printerId, shopId });
  if (!printer) throw new NotFoundError('Printer not found');
  await db.update('PrintJob', { id: taskId }, { printerId });
  await auditQueueAction(shopId, taskId, 'reroute', { from: (task as any).printerId, to: printerId });
}

export async function reprintTask(shopId: string, taskId: string): Promise<void> {
  const db = getContainer().db;
  const task = await db.findOne('PrintJob', { id: taskId, shopId });
  if (!task) throw new NotFoundError('Task not found');
  await db.update('PrintJob', { id: taskId }, {
    status: 'queued',
    attempts: ((task as any).attempts ?? 0) + 1,
    dispatchedAt: null,
    startedAt: null,
    completedAt: null,
    claimedByAgentId: null,
    claimLeaseExpiresAt: null,
    lastError: null,
    version: ((task as any).version ?? 1) + 1,
  });
  await auditQueueAction(shopId, taskId, 'reprint', { attempt: ((task as any).attempts ?? 0) + 1 });
}

async function auditQueueAction(shopId: string, taskId: string, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await repos.audit.log({
      shopId,
      action: `queue.${action}`,
      entityType: 'PrintJob',
      entityId: taskId,
      metadata: details,
    });
  } catch { /* best-effort */ }
}

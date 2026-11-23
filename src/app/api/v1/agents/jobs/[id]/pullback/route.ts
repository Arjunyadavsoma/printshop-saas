import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { ForbiddenError, NotFoundError } from '@platform/core/errors';
import { publishQueueEvent, QUEUE_EVENTS } from '@/lib/queue/queue-events';

/**
 * POST /api/v1/agents/jobs/:id/pullback — device-token-authed
 * (MOBILE agents only).
 *
 * A mobile agent that has claimed a task but cannot complete it (e.g.
 * the printer went offline mid-print) asks the server to create a
 * DeviceCommand instructing the shop's PC to "pull back" the task —
 * i.e. accept it back into the PC's auto-dispatch queue.
 *
 * This is the cooperative handoff path: the phone says "I can't do this
 * right now, please have the PC try." The server creates a
 * `pullback_job` DeviceCommand addressed to the PC agent in the shop;
 * the PC's command poll picks it up, ACKs it, and reclaims the task
 * via the existing pending-job pull.
 *
 * No body.
 *
 * The mobile agent's claim on the task is NOT auto-released here —
 * the PC will claim it once the mobile agent's lease expires (or the
 * mobile agent explicitly releases via /release). This keeps the
 * "exactly once" invariant: there is never a window where both the
 * phone and the PC think they own the task.
 */
const PULLBACK_COMMAND_TYPE = 'pullback_job';
const PULLBACK_TTL_SECONDS = 5 * 60;

interface DeviceCommandRow {
  id: string;
  shopId: string;
  agentId: string;
  commandType: string;
  payload: string;
  status: string;
  initiatedBy: string;
  result: string | null;
  idempotencyKey: string;
  expiresAt: Date;
  deliveredAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PcAgentRow {
  id: string;
  shopId: string;
  kind: string;
  isEnabled: boolean;
  isOnline: boolean;
}

interface PrintJobRow {
  id: string;
  shopId: string;
  claimedByAgentId: string | null;
  status: string;
}

export const POST = withDeviceAuth<{ id: string }>(async (req, ctx, { agent, shopId }) => {
  try {
    if (agent.kind !== 'MOBILE') {
      throw new ForbiddenError(
        `Only MOBILE agents may request a pullback (this agent is '${agent.kind}').`,
      );
    }
    const { id } = await ctx.params;
    const db = getContainer().db;

    // Verify the task exists + belongs to this shop.
    const task = await db.findOne<PrintJobRow>('printJob', { id, shopId });
    if (!task) throw new NotFoundError('Task not found in your shop.');

    // Find a live PC agent in the shop to address the pullback command to.
    // Prefer an ONLINE one; if none are online, address the most-recently
    // seen enabled PC agent (the command will queue until it polls).
    const pcAgents = await db.findMany<PcAgentRow>(
      'printAgent',
      { shopId, kind: 'PC', isEnabled: true },
      { limit: 50, order: ['createdAt', 'desc'] },
    );
    if (pcAgents.length === 0) {
      throw new NotFoundError(
        'No enabled PC agent in this shop — pullback is not possible. Ask the shopkeeper to install PrintEXE on the shop PC.',
      );
    }
    const onlinePc = pcAgents.find((a) => a.isOnline) ?? pcAgents[0]!;

    const now = new Date();
    const idempotencyKey = `pullback:${id}:${agent.id}`;
    // Idempotency: if a pullback command for this (task, agent) already
    // exists, return it unchanged (the phone may retry while waiting).
    const existing = await db.findOne<DeviceCommandRow>('deviceCommand', { idempotencyKey });
    if (existing) {
      return ok({
        taskId: id,
        commandId: existing.id,
        addressedTo: existing.agentId,
        status: existing.status,
        idempotentReplay: true,
      });
    }

    const command = await db.insert<DeviceCommandRow>('deviceCommand', {
      id: crypto.randomUUID(),
      shopId,
      agentId: onlinePc.id,
      commandType: PULLBACK_COMMAND_TYPE,
      payload: JSON.stringify({ taskId: id, requestedBy: agent.id, reason: 'mobile_pullback' }),
      status: 'requested',
      initiatedBy: agent.id,
      result: null,
      idempotencyKey,
      expiresAt: new Date(now.getTime() + PULLBACK_TTL_SECONDS * 1000),
      deliveredAt: null,
      executedAt: null,
      createdAt: now,
      updatedAt: now,
    } as never);

    // Audit (best-effort).
    try {
      await db.insert('auditLog', {
        id: crypto.randomUUID(),
        shopId,
        userId: null,
        action: 'queue.pullback',
        entityType: 'PrintJob',
        entityId: id,
        metadata: JSON.stringify({
          requestedBy: agent.id,
          addressedTo: onlinePc.id,
          commandId: command.id,
        }),
        ip: req.headers.get('x-forwarded-for') || null,
        createdAt: now,
      });
    } catch {
      // best-effort
    }

    await publishQueueEvent(shopId, QUEUE_EVENTS.queueUpdated, {
      taskId: id,
      action: 'pullback_requested',
      addressedTo: onlinePc.id,
    });

    return ok({
      taskId: id,
      commandId: command.id,
      addressedTo: onlinePc.id,
      status: command.status,
      idempotentReplay: false,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

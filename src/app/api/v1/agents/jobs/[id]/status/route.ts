import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';
import { shopChannel } from '@platform/core/interfaces';

const StatusSchema = z.object({
  status: z.enum(['printing', 'completed', 'failed']),
  lastError: z.string().max(500).optional(),
  printerName: z.string().max(200).optional(),
});

/**
 * POST /api/v1/agents/jobs/:id/status — device-token-authed. The agent reports
 * a status transition (queued→printing→completed|failed). Enforces the state
 * machine; updates the PrintJob + File; publishes realtime events so the
 * dashboard updates live. First-claim-wins: a transition that isn't allowed
 * (e.g. an agent claiming a job another agent already claimed) returns 409.
 */
export const POST = withDeviceAuth<{ id: string }>(async (req, ctx, { agent, shopId }) => {
  try {
    const { id } = await ctx.params;
    const body = StatusSchema.parse(await req.json());
    const job = await repos.printJobs.findByIdAndShop(id, shopId);
    if (!job) throw new NotFoundError('Job not found');

    const now = new Date();
    const container = getContainer();
    const channel = shopChannel(shopId);

    if (body.status === 'printing') {
      // ATOMIC CLAIM: conditional update WHERE id AND status='queued'.
      // Only one concurrent agent's update will affect a row; the loser
      // gets an empty result → skipped. This is atomic at the DB level
      // (UPDATE ... WHERE id=? AND status='queued' — row-level locking).
      const claimed = await container.db.update(
        'printJob',
        { id, shopId, status: 'queued' },
        { status: 'printing', agentId: agent.id, startedAt: now },
      );
      if (claimed.length === 0) {
        return ok({ jobId: id, skipped: true, reason: `job is '${job.status}' — already claimed by another agent` });
      }
      await repos.files.update(job.fileId, { status: 'printing' });
      await publish(channel, 'job.printing', { jobId: id, fileId: job.fileId });
    } else if (body.status === 'completed') {
      // Idempotent: conditional update WHERE id AND status='printing'.
      // If the job is already 'completed' (duplicate ack), this is a no-op.
      const updated = await container.db.update(
        'printJob',
        { id, shopId, status: 'printing' },
        { status: 'completed', completedAt: now },
      );
      if (updated.length === 0) {
        return ok({ jobId: id, skipped: true, reason: `job is '${job.status}' — not in 'printing' state (duplicate ack or already completed)` });
      }
      await repos.files.update(job.fileId, { status: 'completed', printedAt: now });
      await publish(channel, 'job.completed', { jobId: id, fileId: job.fileId });
      await maybeMarkOrderReady(job.fileId, shopId, channel);
    } else if (body.status === 'failed') {
      await repos.printJobs.update(id, { status: 'failed', lastError: body.lastError ?? null });
      await repos.files.update(job.fileId, { status: 'failed' });
      await publish(channel, 'job.failed', { jobId: id, fileId: job.fileId, error: body.lastError });
    }

    if (body.printerName) await repos.printAgents.update(agent.id, { printerName: body.printerName });

    return ok({ jobId: id, status: body.status, applied: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

async function publish(channel: string, event: string, payload: unknown): Promise<void> {
  try { await getContainer().realtime.publish(channel, event, payload); } catch { /* best-effort */ }
}

async function maybeMarkOrderReady(fileId: string, shopId: string, channel: string): Promise<void> {
  void shopId;
  const file = await getContainer().db.findOne<{ id: string; orderId: string }>('printFile', { id: fileId });
  if (!file) return;
  const siblings = await repos.files.findByOrder(file.orderId);
  if (siblings.length > 0 && siblings.every((f) => f.status === 'completed')) {
    await repos.orders.update(file.orderId, { status: 'ready' });
    await publish(channel, 'order.ready', { orderId: file.orderId });
  }
}

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { shopChannel } from '@platform/core/interfaces';
import type { PrintJobStatus } from '@platform/core/domain';

const StatusSchema = z.object({
  status: z.enum(['printing', 'completed', 'failed']),
  lastError: z.string().max(500).optional(),
  printerName: z.string().max(200).optional(),
});

/** Allowed job status transitions (the agent drives these). */
const ALLOWED: Record<string, PrintJobStatus[]> = {
  queued: ['printing', 'failed'],
  assigned: ['printing', 'failed'],
  printing: ['completed', 'failed'],
  completed: [],
  failed: ['printing'], // allow a retry
  needs_review: [], // shopkeeper must manually re-queue or complete
};

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

    const allowed = ALLOWED[job.status] ?? [];
    if (!allowed.includes(body.status)) {
      return ok({ jobId: id, skipped: true, reason: `job is '${job.status}' — cannot move to '${body.status}' (already claimed?)` });
    }

    const now = new Date();
    const container = getContainer();
    const channel = shopChannel(shopId);

    if (body.status === 'printing') {
      await repos.printJobs.update(id, { status: 'printing', agentId: agent.id, startedAt: now });
      await repos.files.update(job.fileId, { status: 'printing' });
      await publish(channel, 'job.printing', { jobId: id, fileId: job.fileId });
    } else if (body.status === 'completed') {
      await repos.printJobs.update(id, { status: 'completed', completedAt: now });
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

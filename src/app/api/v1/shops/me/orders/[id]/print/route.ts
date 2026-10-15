import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ensurePrintHandler } from '@/lib/services/print.service';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';

/** POST /api/v1/shops/me/orders/:id/print — dispatch all pending files to the agent. */
export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  ensurePrintHandler();
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'printing')) {
    throw new ValidationError(`Order in status '${order.status}' cannot be sent to print`);
  }

  const files = await repos.files.findByOrder(order.id);
  const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued');
  if (pending.length === 0) throw new ValidationError('No pending files to print');

  // Set the order to "printing" BEFORE dispatching, so the handler's
  // subsequent "ready" transition isn't clobbered (the in-memory queue
  // dispatches on a later turn, matching a real queue's ordering).
  await repos.orders.update(order.id, { status: 'printing' });

  const queue = getContainer().queue;
  const jobs = [];
  for (const f of pending) {
    const job = await repos.printJobs.create({ shopId: shop.id, fileId: f.id });
    await queue.enqueue('print', { jobId: job.id, fileId: f.id, shopId: shop.id });
    jobs.push({ jobId: job.id, fileId: f.id });
  }
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.print',
    entityType: 'order',
    entityId: order.id,
    metadata: { files: pending.length, jobs: jobs.map((j) => j.jobId) },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  return ok({ orderId: order.id, status: 'printing', dispatched: jobs });
});

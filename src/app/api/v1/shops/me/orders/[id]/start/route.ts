import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ensurePrintHandler, dispatchToAgent } from '@/lib/services/print.service';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';

/**
 * POST /api/v1/shops/me/orders/:id/start
 *
 * Alias of /print that ALSO accepts orders with no pending files (so the
 * shopkeeper can mark an order "printing" when they will print manually,
 * e.g. on an offline printer). The dedicated /print route refuses orders
 * without pending files; this one is the more permissive manual-start path.
 *
 * Transition: paid → printing.
 */
export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  ensurePrintHandler();
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'printing')) {
    throw new ValidationError(
      `Order in status '${order.status}' cannot be moved to printing`,
    );
  }

  await repos.orders.update(order.id, { status: 'printing' });

  // Best-effort dispatch: if there ARE pending files, enqueue + push them
  // to the agent (mirrors /print). If not, the order is just marked
  // printing for manual work.
  const files = await repos.files.findByOrder(order.id);
  const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued');
  const jobs: { jobId: string; fileId: string }[] = [];
  if (pending.length > 0) {
    for (const f of pending) {
      const job = await repos.printJobs.create({ shopId: shop.id, fileId: f.id });
      if (process.env.NODE_ENV !== 'production') {
        await getContainer().queue.enqueue('print', { jobId: job.id, fileId: f.id, shopId: shop.id });
      }
      await dispatchToAgent(shop.id, job.id, f.id);
      jobs.push({ jobId: job.id, fileId: f.id });
    }
  }

  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.start_print',
    entityType: 'order',
    entityId: order.id,
    metadata: { files: pending.length, jobs: jobs.map((j) => j.jobId), source: 'manual' },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });
  return ok({ orderId: order.id, status: 'printing', dispatched: jobs });
});

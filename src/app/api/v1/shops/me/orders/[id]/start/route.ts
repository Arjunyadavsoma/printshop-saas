import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ensurePrintHandler, enqueueFilePrint } from '@/lib/services/print.service';
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
 *
 * RACE-SAFE (ARCH-001 + ARCH-003 fix):
 *   - Conditional status transition via `repos.orders.transitionStatus`
 *     (WHERE status='paid') — a double-click won't double-flip.
 *   - Idempotent PrintJob creation via the shared `enqueueFilePrint` helper
 *     (two-layer: findActiveByFile pre-check + P2002 catch). Previously this
 *     route called `repos.printJobs.create` in a loop WITHOUT the guard,
 *     creating duplicate jobs on double-click.
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

  // CONDITIONAL UPDATE — the WHERE status='paid' precondition is the
  // atomic guard. If a concurrent /start already flipped the order to
  // 'printing', this returns null (0 rows) → we still enqueue files (the
  // enqueueFilePrint helper is idempotent) + return the current state.
  const updated = await repos.orders.transitionStatus(order.id, shop.id, 'paid', {
    status: 'printing',
  });

  // Best-effort dispatch: if there ARE pending files, enqueue + push them
  // to the agent (mirrors /print). If not, the order is just marked
  // printing for manual work.
  const files = await repos.files.findByOrder(order.id);
  const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued');
  const jobs: { jobId: string; fileId: string; created: boolean }[] = [];
  for (const f of pending) {
    // IDEMPOTENT enqueue — the shared two-layer guard prevents duplicate
    // PrintJobs even under concurrent /start + webhook auto-dispatch.
    const result = await enqueueFilePrint(shop.id, f.id);
    if (result.jobId) {
      jobs.push({ jobId: result.jobId, fileId: f.id, created: result.created });
    }
  }

  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.start_print',
    entityType: 'order',
    entityId: order.id,
    metadata: { files: pending.length, jobs: jobs.map((j) => j.jobId), source: 'manual', raceSkipped: updated === null },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });
  return ok({ orderId: order.id, status: 'printing', dispatched: jobs });
});

import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/shops/me/orders/:id/activity
 *
 * Returns the chronological activity timeline for an order, derived from
 * the audit log. Includes order creation, payment verification, status
 * transitions, file prints, completions, cancellations — anything the
 * shopkeeper's actions have logged against this order.
 *
 * Sorted oldest-first so the timeline renders top→bottom.
 */
export const GET = withAuth<{ id: string }>(async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');

  const entries = await repos.audit.findByEntity(shop.id, order.id, 100);
  // Reverse so the oldest is first — timeline reads top→bottom.
  entries.reverse();

  return ok({
    orderId: order.id,
    entries: entries.map((e) => ({
      id: e.id,
      action: e.action,
      userId: e.userId,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: e.metadata,
      ip: e.ip,
      createdAt: e.createdAt,
    })),
  });
});

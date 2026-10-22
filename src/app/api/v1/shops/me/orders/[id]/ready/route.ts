import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';

/**
 * POST /api/v1/shops/me/orders/:id/ready
 *
 * Marks an order as ready for customer pickup. Only valid from `printing`.
 * Audit-logs the transition.
 */
export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'ready')) {
    throw new ValidationError(
      `Order in status '${order.status}' cannot be marked ready — must be printing`,
    );
  }
  await repos.orders.update(order.id, { status: 'ready' });
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.ready',
    entityType: 'order',
    entityId: order.id,
    metadata: { previousStatus: order.status },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });
  return ok({ orderId: order.id, status: 'ready' });
});

import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';

/**
 * POST /api/v1/shops/me/orders/:id/cancel
 *
 * Cancels an order. Allowed from any non-terminal state. Audit-logs the
 * cancellation with the shopkeeper's optional reason.
 *
 * Body: { reason?: string }
 */
const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const body = CancelSchema.parse(await req.json());
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'cancelled')) {
    throw new ValidationError(
      `Order in status '${order.status}' cannot be cancelled`,
    );
  }
  await repos.orders.update(order.id, { status: 'cancelled' });
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.cancel',
    entityType: 'order',
    entityId: order.id,
    metadata: { reason: body.reason ?? null, previousStatus: order.status },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });
  return ok({ orderId: order.id, status: 'cancelled' });
});

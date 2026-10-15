import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';
import { getContainer } from '@/lib/container';

/** POST /api/v1/shops/me/orders/:id/complete — mark collected + delete files. */
export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'collected')) {
    throw new ValidationError(`Order in status '${order.status}' cannot be marked collected`);
  }

  await repos.orders.update(order.id, { status: 'collected' });
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.complete',
    entityType: 'order',
    entityId: order.id,
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  // Privacy: per the spec, files are deleted from storage once collected.
  // The 60-second window is the print-agent's responsibility; here we delete
  // the stored blobs immediately and leave the metadata for the audit trail.
  const files = await repos.files.findByOrder(order.id);
  const storage = getContainer().storage;
  await storage.deleteMany(files.map((f) => f.storageKey));

  return ok({ orderId: order.id, status: 'collected', filesDeleted: files.length });
});

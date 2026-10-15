import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';

/** GET /api/v1/shops/me/orders/:id — detail with files. */
export const GET = withAuth<{ id: string }>(async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id); // tenant-scoped
  if (!order) throw new NotFoundError('Order not found');
  const files = await repos.files.findByOrder(order.id);
  return ok({ ...order, files });
});

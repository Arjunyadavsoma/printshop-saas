import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * /api/v1/shops/me/orders/:id
 *
 *  GET    → order detail (incl. files).
 *  PATCH  → update shopkeeper-facing order fields (currently: `notes`).
 *           Notes are private to the shopkeeper (internal remarks about the
 *           customer, special handling, etc.) — never shown to the customer.
 */

/** GET /api/v1/shops/me/orders/:id — detail with files. */
export const GET = withAuth<{ id: string }>(async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id); // tenant-scoped
  if (!order) throw new NotFoundError('Order not found');
  const files = await repos.files.findByOrder(order.id);
  return ok({ ...order, files });
});

const PatchOrderSchema = z.object({
  notes: z.string().max(1000).optional(),
});

/** PATCH /api/v1/shops/me/orders/:id — update shopkeeper notes. */
export const PATCH = withAuth<{ id: string }>(async (req, ctx, principal) => {
  const body = PatchOrderSchema.parse(await req.json());
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');

  // Tenant-scoped update — guard against cross-shop mutation.
  const patch: Record<string, unknown> = {};
  if (body.notes !== undefined) patch.notes = body.notes;
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('No patchable fields supplied');
  }
  const updated = await repos.orders.updateByShop(id, shop.id, patch as Parameters<typeof repos.orders.updateByShop>[2]);
  if (!updated) throw new NotFoundError('Order not found in this shop');

  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.update_notes',
    entityType: 'order',
    entityId: order.id,
    metadata: { fields: Object.keys(patch) },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });
  return ok(updated);
});

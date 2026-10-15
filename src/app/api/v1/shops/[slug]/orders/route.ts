import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';
import { generateOrderToken } from '@platform/utils';

const CreateOrderSchema = z.object({
  customerPhone: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
});

/** POST /api/v1/shops/:slug/orders — create a draft order (no auth). */
export const POST = withRateLimit<{ slug: string }>('create-order', 20, 60, async (req, ctx) => {
  try {
    const { slug } = await ctx.params;
    const shop = await repos.shops.findBySlug(slug);
    if (!shop || !shop.isActive) throw new NotFoundError('Shop not found');

    const body = CreateOrderSchema.parse(await req.json());
    // Ensure a unique token within this shop (retry on collision).
    let token = generateOrderToken();
    for (let i = 0; i < 5; i++) {
      const existing = await repos.orders.listByShop(shop.id, { limit: 1 }).then((os) =>
        os.find((o) => o.customerToken === token),
      );
      if (!existing) break;
      token = generateOrderToken();
    }

    const order = await repos.orders.create({
      shopId: shop.id,
      customerToken: token,
      customerPhone: body.customerPhone ?? null,
      notes: body.notes ?? null,
    });

    await repos.audit.log({
      shopId: shop.id,
      userId: null,
      action: 'order.create',
      entityType: 'order',
      entityId: order.id,
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      orderId: order.id,
      customerToken: order.customerToken,
      status: order.status,
      shop: { name: shop.name, slug: shop.slug },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

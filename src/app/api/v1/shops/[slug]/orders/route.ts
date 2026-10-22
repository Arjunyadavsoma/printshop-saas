import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';
import { generateOrderToken, generateShopOrderTokenNumber } from '@platform/utils';

const CreateOrderSchema = z.object({
  customerPhone: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/v1/shops/:slug/orders — create a draft order (no auth).
 *
 * Returns two tokens:
 *   - customerToken: short unambiguous string (BGBCM5) — used by the
 *     customer to track their order anonymously.
 *   - tokenNumber: per-shop sequential number (A104) — used by the
 *     shopkeeper to call orders aloud ("order A104 is ready").
 */
export const POST = withRateLimit<{ slug: string }>('create-order', 20, 60, async (req, ctx) => {
  try {
    const { slug } = await ctx.params;
    const shop = await repos.shops.findBySlug(slug);
    if (!shop || !shop.isActive) throw new NotFoundError('Shop not found');

    const body = CreateOrderSchema.parse(await req.json());

    // ── Generate a unique customer token (collision retry). ──
    let customerToken = generateOrderToken();
    for (let i = 0; i < 5; i++) {
      const existing = await repos.orders.listByShop(shop.id, { limit: 1 }).then((os) =>
        os.find((o) => o.customerToken === customerToken),
      );
      if (!existing) break;
      customerToken = generateOrderToken();
    }

    // ── Generate a per-shop sequential tokenNumber. The sequence is the
    // count of existing orders in the shop + 1, which is monotonically
    // increasing. On the (vanishingly rare) collision (e.g., a prior order
    // was inserted between count and create), we retry with the next seq. ──
    let tokenNumber: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const existingCount = await repos.orders.countByShop(shop.id);
      const candidate = generateShopOrderTokenNumber(existingCount + 1 + attempt);
      const clash = await repos.orders.findByTokenNumber(shop.id, candidate);
      if (!clash) {
        tokenNumber = candidate;
        break;
      }
    }
    // If every retry collided (extremely unlikely), fall back to null and the
    // shopkeeper will reference the order by customerToken instead.

    const order = await repos.orders.create({
      shopId: shop.id,
      customerToken,
      customerPhone: body.customerPhone ?? null,
      notes: body.notes ?? null,
      tokenNumber,
    });

    await repos.audit.log({
      shopId: shop.id,
      userId: null,
      action: 'order.create',
      entityType: 'order',
      entityId: order.id,
      metadata: { tokenNumber },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      orderId: order.id,
      customerToken: order.customerToken,
      tokenNumber: order.tokenNumber,
      status: order.status,
      shop: { name: shop.name, slug: shop.slug },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

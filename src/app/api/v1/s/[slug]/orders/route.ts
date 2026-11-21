import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { placeOrder } from '@/lib/orders/order-flow';
import { NotFoundError, AppError } from '@platform/core/errors';

/**
 * POST /api/v1/s/[slug]/orders — place the order from the customer's draft.
 * Recomputes the price SERVER-side from the stored specs; if the client
 * total disagrees, the response is PRICES_CHANGED with the new quote and
 * nothing is persisted.
 */
const BodySchema = z.object({
  orderId: z.string().uuid(),
  orderToken: z.string().min(8),
  addonIds: z.array(z.string().uuid()).max(10).default([]),
  urgent: z.boolean().default(false),
  customerName: z.string().max(120).optional().nullable(),
  customerPhone: z.string().regex(/^\d{10}$/, 'Enter a 10-digit Indian mobile number').optional().nullable(),
  note: z.string().max(300).optional().nullable(),
  clientTotalPaise: z.number().int().nonnegative().optional().nullable(),
});

export const POST = withRateLimit('place-order', 20, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    const { slug } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    const db = getContainer().db;
    const shop = await db.findOne<Record<string, unknown>>('shop', { slug });
    if (!shop) throw new NotFoundError('Shop not found');
    const order = await db.findOne<{ id: string; customerToken: string; shopId: string; status: string; notes: string | null } & Record<string, unknown>>('order', { id: body.orderId });
    if (!order || order.customerToken !== body.orderToken || order.shopId !== shop.id) {
      throw new NotFoundError('Order not found');
    }
    const result = await placeOrder(
      shop,
      order as never,
      body.addonIds,
      body.urgent,
      body.clientTotalPaise ?? null,
      body.customerName ?? null,
      body.customerPhone ?? null,
      body.note ?? null,
    );
    return ok(result);
  } catch (cause) {
    const err = cause as { code?: string };
    if (err?.code === 'PRICES_CHANGED') {
      return fail(new AppError((cause as Error).message, 'PRICES_CHANGED', 409, { quote: (cause as { newQuote?: unknown }).newQuote }));
    }
    return fail(toAppError(cause));
  }
});

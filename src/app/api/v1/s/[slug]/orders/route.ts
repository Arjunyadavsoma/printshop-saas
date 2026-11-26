import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { placeOrder } from '@/lib/orders/order-flow';
import { NotFoundError } from '@platform/core/errors';

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

/**
 * Optional customer link: if the request carries a valid customer JWT
 * (role `customer`, issued by the customer exchange route), the placed
 * order is linked to that customer account so it shows in their order
 * history. Absent or invalid token → guest order, exactly as today.
 * The token is verified here, never trusted: a forged, expired, or
 * shopkeeper token simply places a guest order — it can never attach
 * an order to someone else's account.
 */
async function resolveCustomerId(req: NextRequest): Promise<string | null> {
  try {
    const header = req.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return null;
    const claims = await getContainer().auth.verifyAccessToken(token);
    if (!claims || claims.role !== 'customer' || claims.shopId !== null) return null;
    const customer = await repos.customerAccounts.findById(claims.sub);
    return customer?.id ?? null;
  } catch {
    return null;
  }
}

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
    const customerId = await resolveCustomerId(req);
    const result = await placeOrder(
      shop,
      order as never,
      body.addonIds,
      body.urgent,
      body.clientTotalPaise ?? null,
      body.customerName ?? null,
      body.customerPhone ?? null,
      body.note ?? null,
      customerId,
    );
    return ok(result);
  } catch (cause) {
    const err = cause as { code?: string; newTotalPaise?: number; newQuote?: unknown };
    if (err?.code === 'PRICES_CHANGED') {
      // Feature 4 (W9): put the new total + full quote in `data` so the
      // client can show the updated amount without a separate re-fetch.
      // The error envelope keeps the code/message/details for logging;
      // `data` carries the recoverable payload the client needs to proceed.
      const quote = err.newQuote as { totalPaise?: number | null } | undefined;
      return NextResponse.json(
        {
          success: false,
          data: {
            totalPaise: err.newTotalPaise ?? quote?.totalPaise ?? null,
            quote: err.newQuote ?? null,
          },
          error: {
            code: 'PRICES_CHANGED',
            message: (cause as Error).message,
            details: { quote: err.newQuote },
          },
        },
        { status: 409 },
      );
    }
    return fail(toAppError(cause));
  }
});

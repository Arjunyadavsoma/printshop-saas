import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { cancelOrder } from '@/lib/orders/order-flow';

/** POST /api/v1/o/[token]/cancel — customer cancel (only before PRINTING). */
const BodySchema = z.object({ reason: z.string().max(300).default('') });

export const POST = withRateLimit<{ token: string }>('order-cancel', 20, 60, async (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
  try {
    const { token } = await ctx.params;
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    return ok(await cancelOrder(token, body.reason || 'Cancelled by customer'));
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

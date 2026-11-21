import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withAuth } from '@/lib/api/with-auth';
import { confirmPayment, rejectPayment } from '@/lib/orders/order-flow';
import { ValidationError } from '@platform/core/errors';

/**
 * POST /api/v1/shops/me/orders/[id]/confirm-payment — shopkeeper confirms
 * (or rejects) the customer's UPI submission. OPERATORs may do this (it is
 * a counter operation, not a pricing one).
 */
const BodySchema = z.object({
  action: z.enum(['confirm', 'reject']),
  method: z.enum(['upi', 'counter_cash', 'counter_upi']).optional(),
  reason: z.string().max(300).optional(),
});

export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  try {
    const { id } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    if (body.action === 'confirm') {
      const res = await confirmPayment(id, principal.shopId!, principal.userId, body.method);
      return ok(res);
    }
    if (!body.reason) throw new ValidationError('Give the customer a reason so they can fix the payment.');
    const res = await rejectPayment(id, principal.shopId!, principal.userId, body.reason);
    return ok(res);
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

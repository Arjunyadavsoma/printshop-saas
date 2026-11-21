import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { submitPayment } from '@/lib/orders/order-flow';

/**
 * POST /api/v1/o/[token]/payment — the customer submits UTR (UPI) or picks
 * counter payment. The path token IS the credential (128-bit, unguessable);
 * submitPayment resolves the order by it and enforces the state machine.
 * The order is NOT marked paid: verification is the shopkeeper's job
 * (PaymentVerifier MANUAL default).
 */
const BodySchema = z.object({
  method: z.enum(['upi', 'counter_cash', 'counter_upi']),
  utr: z.string().regex(/^\d{12}$/).optional(),
});

export const POST = withRateLimit<{ token: string }>('order-payment', 20, 60, async (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
  try {
    const { token } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    const result = await submitPayment(token, {
      method: body.method,
      utr: body.utr,
      screenshotBytes: undefined, // screenshot upload is a separate presigned flow (Phase 8 polish)
    });
    return ok(result);
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

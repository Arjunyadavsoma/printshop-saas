import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { processRazorpayCheckoutSuccess } from '@/lib/payments/razorpay-webhook';

/**
 * POST /api/v1/payments/razorpay/verify — the Checkout.js success handler.
 * Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature, merchantOrderId? }.
 * Verifies HMAC(order|payment) with the shop's keySecret, then runs the same
 * fail-closed server re-verification + atomic transition as the webhook.
 */
const VerifySchema = z.object({
  razorpayOrderId: z.string().min(6).max(120),
  razorpayPaymentId: z.string().min(6).max(120),
  razorpaySignature: z.string().min(16).max(256),
  merchantOrderId: z.string().uuid().nullable().optional(),
});

export const POST = withRateLimit('checkout', 20, 60, async (req: NextRequest) => {
  try {
    const body = VerifySchema.parse(await req.json());
    const result = await processRazorpayCheckoutSuccess({
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
      merchantOrderId: body.merchantOrderId ?? null,
      ip: req.headers.get('x-forwarded-for'),
    });
    if (result.statusCode !== 200 || !result.applied) {
      return NextResponse.json(
        { success: true, data: { paid: false, summary: result.summary, orderId: result.orderId ?? null } },
        { status: result.statusCode },
      );
    }
    return ok({ paid: true, orderId: result.orderId, summary: result.summary });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

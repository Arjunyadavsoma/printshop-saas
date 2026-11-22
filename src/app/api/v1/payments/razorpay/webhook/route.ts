import { NextRequest, NextResponse } from 'next/server';
import { processRazorpayWebhook } from '@/lib/payments/razorpay-webhook';

/**
 * POST /api/v1/payments/razorpay/webhook — Razorpay server-to-server events.
 * Signature: X-Razorpay-Signature = HMAC_SHA256(rawBody, shop webhookSecret).
 * Only payment.captured / order.paid credit an order; refunds and failures
 * are recorded without marking paid.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature');
  const ip = req.headers.get('x-forwarded-for');
  try {
    const result = await processRazorpayWebhook(rawBody, signature, ip);
    return NextResponse.json({ applied: result.applied, summary: result.summary }, { status: result.statusCode });
  } catch {
    // Never leak provider internals.
    return NextResponse.json(
      { applied: false, summary: 'webhook processing error' },
      { status: 500 },
    );
  }
}

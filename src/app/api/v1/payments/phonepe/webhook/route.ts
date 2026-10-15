import { NextResponse, type NextRequest } from 'next/server';
import { processWebhook } from '@/lib/payments/webhook.service';

/**
 * POST /api/v1/payments/phonepe/webhook — PhonePe callback.
 * Unauthenticated but signature-verified (X-VERIFY). Idempotent.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const result = await processWebhook({
    provider: 'phonepe',
    rawBody,
    headers,
    path: '/api/v1/payments/phonepe/webhook',
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  // PhonePe expects a 200 with body "OK" when the callback is accepted.
  if (result.responseBody) {
    return new NextResponse(result.responseBody, {
      status: result.statusCode,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return NextResponse.json(
    { success: result.statusCode < 400, data: { summary: result.summary, applied: result.applied, orderId: result.orderId } },
    { status: result.statusCode },
  );
}

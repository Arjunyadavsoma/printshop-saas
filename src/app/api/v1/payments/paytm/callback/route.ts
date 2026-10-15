import { NextResponse, type NextRequest } from 'next/server';
import { processWebhook } from '@/lib/payments/webhook.service';

/**
 * POST /api/v1/payments/paytm/callback — Paytm callback.
 * Form-urlencoded with CHECKSUMHASH. Renders an HTML page (NOT JSON) per spec.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const result = await processWebhook({
    provider: 'paytm',
    rawBody,
    headers,
    path: '/api/v1/payments/paytm/callback',
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  // Paytm wants an HTML page rendered back to the customer's browser.
  if (result.responseBody) {
    return new NextResponse(result.responseBody, {
      status: result.statusCode,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return NextResponse.json(
    { success: result.statusCode < 400, data: { summary: result.summary, applied: result.applied, orderId: result.orderId } },
    { status: result.statusCode },
  );
}

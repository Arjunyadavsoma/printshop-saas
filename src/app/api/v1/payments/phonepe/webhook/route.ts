import { NextResponse, type NextRequest } from 'next/server';
import { processWebhook } from '@/lib/payments/webhook.service';
import { processPhonePeV2Webhook } from '@/lib/payments/phonepe-v2-webhook';

/**
 * POST /api/v1/payments/phonepe/webhook — PhonePe callback.
 *
 * Supports BOTH webhook formats:
 *
 * v1 (Standard API): base64 body + X-VERIFY header (SHA256 checksum with
 *   saltKey). Handled by processWebhook() → PhonePePaymentAdapter.handleWebhook().
 *
 * v2 (Business API): plain JSON body { event, payload } + Authorization
 *   header = bare SHA256(username:password) hex. Handled by
 *   processPhonePeV2Webhook(). Event routing:
 *     - pg.order.completed / checkout.order.completed → mark order paid
 *     - pg.refund.completed → record refund (NEVER marks paid)
 *     - checkout.order.failed / paylink.order.failed → leave awaiting_payment
 *     - Other events → log + acknowledge (200)
 *
 * Detection: if the `Authorization` header contains a 64-char hex string
 * (SHA-256) AND the body is valid JSON with an `event` field → v2 format.
 * Otherwise → v1 format (X-VERIFY + base64).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const authHeader = req.headers.get('authorization');
  const ip = req.headers.get('x-forwarded-for') ?? null;

  // ── Detect v2 format ──
  // v2 sends: Authorization = bare SHA256 hex (64 chars) + JSON body with `event`.
  const isV2 = !!authHeader
    && /^[0-9a-f]{64}$/i.test(authHeader.trim())
    && rawBody.trim().startsWith('{')
    && rawBody.includes('"event"');

  if (isV2) {
    // ── v2 Business API webhook ──
    const result = await processPhonePeV2Webhook(rawBody, authHeader, ip);
    return NextResponse.json(
      { success: result.statusCode < 400, data: { summary: result.summary, applied: result.applied, orderId: result.orderId } },
      { status: result.statusCode },
    );
  }

  // ── v1 Standard API webhook (existing path) ──
  const result = await processWebhook({
    provider: 'phonepe',
    rawBody,
    headers,
    path: '/api/v1/payments/phonepe/webhook',
    ip,
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

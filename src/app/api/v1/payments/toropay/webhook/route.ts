import { NextRequest, NextResponse } from 'next/server';
import { processWebhook } from '@/lib/payments/webhook.service';

/**
 * POST /api/v1/payments/toropay/webhook — ToroPay server-to-server events.
 *
 * ToroPay (https://www.toropay.co.in/) sends webhook events with:
 *   - Header: `X-ToroPay-Event` (event type, e.g. "payment.confirmed")
 *   - Header: `X-ToroPay-Signature` (HMAC SHA-256 hex of the raw body)
 *   - Body: JSON envelope `{ event_id, event_type, created_at, data: {...} }`
 *
 * The webhook is processed through the existing `processWebhook()` pipeline
 * (webhook.service.ts) which:
 *   1. Audit-logs the raw payload.
 *   2. Calls the adapter's `handleWebhook()` for signature verification.
 *   3. Validates amount, currency, and order reference.
 *   4. Atomically transitions the PaymentAttempt + Order via
 *      `applyPaymentTransition()` (single db.$transaction).
 *   5. Deduplicates via PaymentEvent UNIQUE([provider, eventId]) + cache.
 *
 * Two payment paths:
 *   - `payment.confirmed` → provider checkout settled → order auto-finalized.
 *   - `payment.paid` / `order.paid` → direct UPI → order stays "pending
 *     merchant verification" (NOT auto-finalized; the shopkeeper must confirm).
 *
 * Security: raw body is read BEFORE JSON parsing so the signature covers the
 * exact bytes received. Missing/malformed signatures return 400.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key] = value; });
  const ip = req.headers.get('x-forwarded-for');

  try {
    const result = await processWebhook({
      provider: 'toropay',
      rawBody,
      headers,
      path: '/api/v1/payments/toropay/webhook',
      ip,
    });
    return NextResponse.json(
      { applied: result.applied, summary: result.summary },
      { status: result.statusCode },
    );
  } catch {
    // Never leak provider internals or stack traces.
    return NextResponse.json(
      { applied: false, summary: 'webhook processing error' },
      { status: 500 },
    );
  }
}

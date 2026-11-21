import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { requireDev } from '@/lib/api/require-dev';
import { NotFoundError } from '@platform/core/errors';
import { processWebhook } from '@/lib/payments/webhook.service';

const SimulateSchema = z.object({
  orderId: z.string().uuid(),
  /** 'paid' | 'failed' — the state to simulate. */
  outcome: z.enum(['paid', 'failed']).default('paid'),
  /**
   * Optional: the merchantOrderId returned by /checkout. PhonePe echoes this
   * back as merchantTransactionId in the webhook. If omitted, the simulate
   * route falls back to orderId (legacy dev behaviour).
   *
   * Phase-2 fix: checkout mints merchantOrderIds in the format
   * `checkout-<uuid>-<timestamp>` (see the checkout route), which is NOT a
   * UUID — the old z.string().uuid() rejected every real checkout
   * merchantOrderId, making the route unusable for its documented purpose.
   */
  merchantOrderId: z.string().min(1).max(200).optional(),
});

/** hex(sha256(s)) via Web Crypto. */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * POST /api/v1/payments/dev/phonepe/simulate — DEV ONLY.
 *
 * Signs a PhonePe webhook payload with the shop's dev salt key and feeds it
 * through the REAL processWebhook pipeline (signature verify + idempotency +
 * order flip). Visible, runnable exercise of the X-VERIFY verification path
 * without a live PhonePe account. Call it twice with the same txnId to see
 * idempotency in action.
 */
export const POST = withRateLimit('phonepe-simulate', 20, 60, async (req, _ctx) => {
  const guard = requireDev();
  if (guard) return guard;
  try {
    const body = SimulateSchema.parse(await req.json());
    const order = await repos.orders.findById(body.orderId);
    if (!order) throw new NotFoundError('Order not found');
    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    const creds = (shop.paymentCredentials.phonepe ?? {}) as { saltKey: string; saltIndex: string; merchantId?: string };
    if (!creds.saltKey) {
      throw new NotFoundError('Shop has no PhonePe dev credentials — re-seed');
    }

    const txnId = 'T' + Date.now().toString(36).toUpperCase();
    const paid = body.outcome === 'paid';
    const payload = {
      // UPIPay's verifyWebhook maps status from the TOP-LEVEL `code` field
      // (mapStatus(parsedPayload.code)) — a callback without it verifies as
      // FAILED. Phase-2 fix: the old shape (responseCode nested in data) was
      // never accepted by the pipeline it feeds.
      code: paid ? 'PAYMENT_SUCCESS' : 'PAYMENT_ERROR',
      data: {
        merchantId: creds.merchantId ?? 'DEMO',
        // merchantTransactionId MUST match the merchantOrderId stored at
        // checkout (that's the key the webhook looks up). Accept it as an
        // optional body param; fall back to orderId for legacy dev tests.
        merchantTransactionId: body.merchantOrderId ?? order.id,
        transactionId: txnId,
        amount: order.totalAmountPaise,
        state: paid ? 'COMPLETED' : 'FAILED',
        paymentInstrument: { type: 'UPI', utr: txnId },
        responseCode: paid ? 'PAYMENT_SUCCESS' : 'PAYMENT_ERROR',
      },
    };
    const base64Body = btoa(JSON.stringify(payload));
    // Phase-2 fix: the adapter verifies sha256(base64Body + saltKey) — the
    // STATUS-API path ('/pg/v1/status') was never part of the CALLBACK
    // checksum, so the old signature never verified.
    const xVerify = (await sha256Hex(base64Body + creds.saltKey)) + '###' + creds.saltIndex;

    // Feed the signed payload through the REAL webhook pipeline.
    const result = await processWebhook({
      provider: 'phonepe',
      rawBody: base64Body,
      headers: { 'x-verify': xVerify },
      path: '/api/v1/payments/phonepe/webhook',
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      sent: {
        xVerifyPrefix: xVerify.slice(0, 16) + '…',
        saltIndex: creds.saltIndex,
        txnId,
        outcome: body.outcome,
      },
      processed: {
        statusCode: result.statusCode,
        summary: result.summary,
        applied: result.applied,
        orderId: result.orderId,
      },
      note: 'real X-VERIFY computed with the shop dev salt; processWebhook verified it.',
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

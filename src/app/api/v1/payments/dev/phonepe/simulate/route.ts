import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';
import { processWebhook } from '@/lib/payments/webhook.service';

const SimulateSchema = z.object({
  orderId: z.string().uuid(),
  /** 'paid' | 'failed' — the state to simulate. */
  outcome: z.enum(['paid', 'failed']).default('paid'),
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
    const payload = {
      data: {
        merchantId: creds.merchantId ?? 'DEMO',
        // merchantTransactionId matches the merchantOrderId stored at checkout
        // (the demo uses orderId as merchantOrderId).
        merchantTransactionId: order.id,
        transactionId: txnId,
        amount: order.totalAmountPaise,
        state: body.outcome === 'paid' ? 'COMPLETED' : 'FAILED',
        paymentInstrument: { type: 'UPI', utr: txnId },
        responseCode: body.outcome === 'paid' ? 'PAYMENT_SUCCESS' : 'PAYMENT_ERROR',
      },
    };
    const base64Body = btoa(JSON.stringify(payload));
    const verifyPath = '/pg/v1/status';
    const xVerify = (await sha256Hex(base64Body + verifyPath + creds.saltKey)) + '###' + creds.saltIndex;

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

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  PaymentAdapter,
  PaymentIntent,
  PaymentVerification,
  RefundInput,
  RefundResult,
  WebhookInput,
  WebhookResult,
} from '@platform/core/interfaces';
import type { PaymentProvider } from '@platform/core/domain';

/**
 * RazorpayPaymentAdapter — "easy button" KYC gateway (cards / UPI /
 * netbanking / wallets through Razorpay Checkout).
 *
 * Money flows to the SHOPKEEPER's own Razorpay account (platform takes no
 * commission — same rule as every adapter). Per-shop credentials come from
 * `shop.paymentCredentials` (encrypted at rest, decrypted by the routes):
 *   { razorpay: { authVersion: 'razorpay', keyId, keySecret, webhookSecret?, env } }
 *
 * Flow:
 *   1. createPaymentIntent → POST /v1/orders (receipt = merchantOrderId
 *      VERBATIM, notes carry it too) → PaymentIntent.gatewayOrderId =
 *      Razorpay's `order_xxx` + publishableKey for Checkout.js.
 *   2. Customer pays in Razorpay Checkout; the checkout success handler
 *      posts razorpay_order_id|payment_id|signature to
 *      POST /api/v1/payments/razorpay/verify (HMAC order|payment vs keySecret)
 *      and the webhook POST /api/v1/payments/razorpay/webhook verifies
 *      X-Razorpay-Signature = HMAC_SHA256(rawBody, webhookSecret).
 *   3. Both paths funnel through the shared lifecycle (applyPaymentTransition)
 *      with server-side re-verification (fail-closed).
 */

const RZP_API = 'https://api.razorpay.com/v1';

/** Decrypt-free credential shape (the routes pass the decrypted JSON). */
interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  env?: 'test' | 'live';
}

function creds(input: Record<string, unknown>): RazorpayCredentials {
  // shop.paymentCredentials is a per-provider map: { razorpay: {...}, phonepe: {...} }
  const c = (input?.razorpay ?? input) as unknown as RazorpayCredentials;
  if (!c?.keyId || !c?.keySecret) {
    throw new Error('Razorpay is not configured for this shop (missing keyId/keySecret)');
  }
  return c;
}

/** Basic-auth fetch against the Razorpay API. Never logs credentials. */
async function rzpApi(
  method: 'GET' | 'POST',
  path: string,
  c: RazorpayCredentials,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const auth = Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64');
  const res = await fetch(`${RZP_API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json: Record<string, unknown> = await res.json().catch(() => ({}) as Record<string, unknown>);
  const errorDesc = (json as { error?: { description?: string } }).error?.description;
  if (!res.ok) {
    const desc = errorDesc ?? `HTTP ${res.status}`;
    throw new Error(`Razorpay API error: ${desc}`);
  }
  return json;
}

export class RazorpayPaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'razorpay';

  async createPaymentIntent(input: {
    orderId: string;
    amountPaise: number;
    customerPhone?: string;
    shopUpiId: string;
    shopName?: string;
    customerToken?: string;
    shopCredentials: Record<string, unknown>;
    /** MANDATORY — used verbatim as the Razorpay order `receipt` + note. */
    merchantOrderId: string;
  }): Promise<PaymentIntent> {
    const c = creds(input.shopCredentials);
    const merchantOrderId = input.merchantOrderId;
    const order = await rzpApi('POST', '/orders', c, {
      amount: input.amountPaise, // Razorpay expects paise, like we do
      currency: 'INR',
      receipt: merchantOrderId,
      notes: {
        merchantOrderId,
        internalOrderId: input.orderId,
        customerToken: input.customerToken ?? '',
      },
    });
    const rzpOrderId = String(order.id ?? '');
    if (!rzpOrderId) throw new Error('Razorpay order creation returned no id');

    return {
      merchantOrderId,
      orderId: input.orderId,
      amountPaise: input.amountPaise,
      currency: 'INR',
      // Razorpay Checkout.js opens from the client; we hand over the
      // publishable key + the gateway order id (additive PaymentIntent fields).
      gatewayOrderId: rzpOrderId,
      publishableKey: c.keyId,
      provider: 'razorpay',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
  }

  /** Server-side re-verification (fail-closed): any CAPTURED payment on the
   *  Razorpay order. Used by the verify route AND the webhook pipeline. */
  async verifyPayment(input: {
    merchantOrderId: string;
    shopCredentials: Record<string, unknown>;
    gatewayOrderId?: string;
  }): Promise<PaymentVerification> {
    const c = creds(input.shopCredentials);
    let rzpOrderId: string | null = null;
    if (input.gatewayOrderId && String(input.gatewayOrderId).startsWith('order_')) {
      rzpOrderId = String(input.gatewayOrderId);
    } else if (String(input.merchantOrderId).startsWith('order_')) {
      rzpOrderId = String(input.merchantOrderId);
    }
    if (!rzpOrderId) {
      // Razorpay has no receipt-lookup API — the webhook/verify routes
      // resolve the gateway order from PaymentAttempt before calling us.
      throw new Error('Razorpay verifyPayment needs the gateway order id (order_...)');
    }
    const data = await rzpApi('GET', `/orders/${rzpOrderId}/payments`, c);
    const items = (data.items ?? []) as Array<Record<string, unknown>>;
    const captured = items.find((p) => p.status === 'captured');
    if (!captured) {
      return { paid: false, txnId: null, utr: null, amountPaise: null, provider: 'razorpay', raw: data };
    }
    const acq = (captured.acquirer_data ?? {}) as Record<string, unknown>;
    return {
      paid: true,
      txnId: String(captured.id ?? ''),
      utr: (acq.rrn as string) ?? (acq.upi_transaction_id as string) ?? String(captured.id ?? ''),
      amountPaise: Number(captured.amount ?? 0),
      provider: 'razorpay',
      raw: captured,
    };
  }

  async handleWebhook(input: WebhookInput, shopCredentials: Record<string, unknown>): Promise<WebhookResult> {
    const c = creds(shopCredentials);
    if (!c.webhookSecret) {
      return {
        ok: false,
        verification: null,
        statusCode: 503,
        responseBody: JSON.stringify({ error: 'webhook secret not configured' }),
      };
    }
    const sig = input.headers['x-razorpay-signature'] ?? '';
    const expected = createHmac('sha256', c.webhookSecret).update(input.rawBody).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, verification: null, statusCode: 400, responseBody: JSON.stringify({ error: 'invalid signature' }) };
    }

    let body: {
      event?: string;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      return { ok: false, verification: null, statusCode: 400, responseBody: JSON.stringify({ error: 'bad json' }) };
    }

    const entity = body.payload?.payment?.entity ?? {};
    const entityOrder = String(entity.order_id ?? '');
    const txnId = String(entity.id ?? '');
    const amount = Number(entity.amount ?? 0);
    const acq = (entity.acquirer_data ?? {}) as Record<string, unknown>;
    const utr = (acq.rrn as string) ?? (acq.upi_transaction_id as string) ?? txnId;

    // Only `payment.captured` credits the order. Refunds/failures are
    // recorded honestly without marking paid (parity with PhonePe v2).
    const captured = body.event === 'payment.captured';
    if (!captured) {
      return {
        ok: true,
        verification: { paid: false, txnId: txnId || null, utr: null, amountPaise: amount || null, provider: 'razorpay', raw: body },
        statusCode: 200,
      };
    }
    return {
      ok: true,
      verification: {
        paid: true,
        txnId,
        utr,
        amountPaise: amount,
        provider: 'razorpay',
        raw: body,
      },
      statusCode: 200,
      responseBody: JSON.stringify({ ok: true, gatewayOrderId: entityOrder }),
    };
  }

  async refund(input: RefundInput, shopCredentials: Record<string, unknown>): Promise<RefundResult> {
    const c = creds(shopCredentials);
    const res = await rzpApi('POST', `/payments/${input.paymentTxnId}/refund`, c, {
      amount: input.amountPaise,
      notes: { reason: input.reason.slice(0, 200) },
    });
    return {
      refundId: String(res.id ?? ''),
      amountPaise: Number(res.amount ?? input.amountPaise),
      status: res.status === 'processed' ? 'completed' : 'pending',
    };
  }
}

/**
 * ToroPay payment adapter — UPI payment-link platform.
 *
 * ToroPay (https://www.toropay.co.in/) is a UPI payment-link and checkout
 * platform, not a conventional payment gateway. Two payment paths:
 *
 * 1. **Direct UPI** — the customer pays the merchant's own UPI ID. ToroPay
 *    sends a `payment.paid` webhook, but the merchant MUST confirm receipt.
 *    The order stays in "pending merchant verification" — NOT auto-finalized.
 *
 * 2. **Provider checkout** — ToroPay orchestrates a hosted checkout (Razorpay/
 *    Cashfree). A `payment.confirmed` webhook with a valid signature settles
 *    the payment — the order IS auto-finalized.
 *
 * This adapter implements the existing `PaymentAdapter` interface so ToroPay
 * slots into the existing registry + lifecycle service without any changes to
 * the payment architecture.
 *
 * ENVIRONMENT VARIABLES (server-side only, never exposed to client):
 *   TOROPAY_API_BASE_URL — e.g. "https://api.toropay.co.in/v1" (ASSUMED — verify)
 *   TOROPAY_API_KEY      — merchant API key (ASSUMED Bearer auth — verify)
 *   TOROPAY_WEBHOOK_SECRET — HMAC SHA-256 signing secret for webhooks
 *   TOROPAY_MODE         — "test" | "live"
 *   TOROPAY_RETURN_URL   — URL the customer returns to after payment
 *
 * API CONTRACT ASSUMPTIONS — these are based on the ToroPay dashboard
 * information provided in the task and common UPI payment-link platform
 * patterns. They MUST be reconciled with the latest official documentation
 * at https://www.toropay.co.in/docs before live use. See
 * docs/PRINTELYX-TOROPAY-API-CONTRACT.md for the verified vs assumed matrix.
 */

import type {
  PaymentAdapter,
  PaymentIntent,
  PaymentVerification,
  WebhookInput,
  WebhookResult,
  RefundInput,
  RefundResult,
} from '@platform/core/interfaces/payment.adapter';
import type { PaymentProvider } from '@platform/core/domain';
import {
  verifyToroPaySignature,
  parseToroPayEvent,
  classifyToroPayEvent,
  extractMerchantOrderId,
  extractPaymentDetails,
} from '@/lib/payments/toropay-webhook';

const TOROPAY_API_BASE_URL = () => process.env.TOROPAY_API_BASE_URL ?? 'https://api.toropay.co.in/v1';
const TOROPAY_API_KEY = () => process.env.TOROPAY_API_KEY ?? '';
const TOROPAY_WEBHOOK_SECRET = () => process.env.TOROPAY_WEBHOOK_SECRET ?? '';
const TOROPAY_MODE = () => process.env.TOROPAY_MODE ?? 'test';
const TOROPAY_RETURN_URL = () => process.env.TOROPAY_RETURN_URL ?? '';

export class ToroPayPaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'toropay';

  /**
   * Create a payment link/checkout via the ToroPay API.
   *
   * The merchantOrderId (our internal reference) is sent to ToroPay as the
   * `merchant_order_id` field. ToroPay returns a hosted checkout URL where
   * the customer pays.
   *
   * ASSUMED request body (verify against https://www.toropay.co.in/docs):
   *   POST {base}/orders
   *   Authorization: Bearer {api_key}
   *   {
   *     "merchant_order_id": "<our UUID>",
   *     "amount_paise": 50000,
   *     "currency": "INR",
   *     "customer": { "phone": "...", "name": "..." },
   *     "return_url": "https://...",
   *     "description": "Printelyx order <orderNumber>"
   *   }
   *
   * ASSUMED response:
   *   {
   *     "id": "toropay_order_xxx",
   *     "checkout_url": "https://www.toropay.co.in/checkout/xxx",
   *     "amount_paise": 50000,
   *     "status": "created",
   *     "expires_at": "2026-..."
   *   }
   */
  async createPaymentIntent(input: {
    orderId: string;
    amountPaise: number;
    customerPhone?: string;
    shopUpiId: string;
    shopName?: string;
    customerToken?: string;
    shopCredentials: Record<string, unknown>;
    merchantOrderId: string;
  }): Promise<PaymentIntent> {
    const apiKey = TOROPAY_API_KEY();
    if (!apiKey) {
      throw new Error('TOROPAY_API_KEY is not set. Configure it in the environment to use ToroPay.');
    }

    const returnUrl = TOROPAY_RETURN_URL();
    const body = {
      merchant_order_id: input.merchantOrderId,
      amount_paise: input.amountPaise,
      currency: 'INR',
      customer: {
        phone: input.customerPhone ?? undefined,
        name: input.shopName,
      },
      return_url: returnUrl || undefined,
      description: `Printelyx order ${input.customerToken ?? input.orderId}`,
      // Direct UPI parameters — the merchant's own UPI ID is the payee.
      // ToroPay creates a payment link that shows this UPI ID for direct
      // payment, or orchestrates a provider checkout if the merchant has
      // provider checkout enabled.
      upi_id: input.shopUpiId,
      mode: TOROPAY_MODE(),
    };

    const res = await fetch(`${TOROPAY_API_BASE_URL()}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown error');
      throw new Error(`ToroPay order creation failed (${res.status}): ${errorText.slice(0, 200)}`);
    }

    const data = await res.json() as {
      id?: string;
      checkout_url?: string;
      amount_paise?: number;
      status?: string;
      expires_at?: string;
    };

    const expiresAt = data.expires_at ? new Date(data.expires_at) : new Date(Date.now() + 30 * 60 * 1000);

    return {
      merchantOrderId: input.merchantOrderId,
      orderId: input.orderId,
      amountPaise: data.amount_paise ?? input.amountPaise,
      currency: 'INR',
      checkoutUrl: data.checkout_url,
      gatewayOrderId: data.id,
      provider: 'toropay',
      expiresAt,
    };
  }

  /**
   * Poll the ToroPay status API for a payment's current state.
   * Used as a fallback when webhooks are delayed.
   *
   * ASSUMED endpoint (verify against docs):
   *   GET {base}/orders/{merchantOrderId}
   *   Authorization: Bearer {api_key}
   */
  async verifyPayment(input: {
    merchantOrderId: string;
    shopCredentials: Record<string, unknown>;
    gatewayOrderId?: string;
  }): Promise<PaymentVerification> {
    const apiKey = TOROPAY_API_KEY();
    if (!apiKey) {
      return { paid: false, txnId: null, utr: null, amountPaise: null, provider: 'toropay', raw: { error: 'TOROPAY_API_KEY not set' } };
    }

    try {
      const res = await fetch(
        `${TOROPAY_API_BASE_URL()}/orders/${input.gatewayOrderId ?? input.merchantOrderId}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } },
      );
      if (!res.ok) {
        return { paid: false, txnId: null, utr: null, amountPaise: null, provider: 'toropay', raw: { status: res.status } };
      }
      const data = await res.json() as {
        status?: string;
        payment?: { txn_id?: string; amount_paise?: number; status?: string };
        amount_paise?: number;
      };
      const paid = data.status === 'paid' || data.payment?.status === 'confirmed';
      return {
        paid,
        txnId: data.payment?.txn_id ?? null,
        utr: data.payment?.txn_id ?? null,
        amountPaise: data.payment?.amount_paise ?? data.amount_paise ?? null,
        provider: 'toropay',
        raw: data,
      };
    } catch (cause) {
      return { paid: false, txnId: null, utr: null, amountPaise: null, provider: 'toropay', raw: { error: String(cause) } };
    }
  }

  /**
   * Verify + parse an inbound ToroPay webhook.
   *
   * Security:
   *   1. Read raw body (the route handler passes it as `rawBody`).
   *   2. Verify HMAC SHA-256 using TOROPAY_WEBHOOK_SECRET + timingSafeEqual.
   *   3. Parse the event envelope.
   *   4. Classify the event (provider_checkout vs direct_upi vs failed).
   *   5. Return the verification result for the lifecycle service to process.
   */
  async handleWebhook(input: WebhookInput, _shopCredentials: Record<string, unknown>): Promise<WebhookResult> {
    const secret = TOROPAY_WEBHOOK_SECRET();
    if (!secret) {
      return {
        ok: false,
        verification: null,
        statusCode: 503,
        responseBody: JSON.stringify({ error: 'TOROPAY_WEBHOOK_SECRET not configured' }),
      };
    }

    const signature = input.headers['x-toropay-signature'] ?? input.headers['X-ToroPay-Signature'];
    if (!verifyToroPaySignature(input.rawBody, signature, secret)) {
      return {
        ok: false,
        verification: null,
        statusCode: 400,
        responseBody: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    const event = parseToroPayEvent(input.rawBody);
    if (!event) {
      return {
        ok: false,
        verification: null,
        statusCode: 400,
        responseBody: JSON.stringify({ error: 'Malformed event' }),
      };
    }

    const { paid, failed, settlementMode } = classifyToroPayEvent(event.event_type);
    const merchantOrderId = extractMerchantOrderId(event);
    const details = extractPaymentDetails(event);

    // A payment.confirmed event means the provider checkout path settled —
    // the payment IS paid. A payment.paid / order.paid event means direct
    // UPI — the merchant must still confirm, so `paid` is false here.
    const isPaid = paid && settlementMode === 'provider_checkout';

    const verification: PaymentVerification = {
      paid: isPaid,
      txnId: details.providerTxnId,
      utr: details.utr,
      amountPaise: details.amountPaise,
      provider: 'toropay',
      raw: event,
    };

    return {
      ok: true,
      verification,
      statusCode: 200,
      responseBody: JSON.stringify({ received: true, event_id: event.event_id }),
    };
  }

  /**
   * Initiate a refund via ToroPay.
   *
   * ToroPay's refund capability is NOT verified — the documentation mentions
   * it but whether the merchant account supports it depends on the account
   * configuration. If the API returns an error indicating refunds are not
   * supported, we return `status: 'failed'` with the error message.
   *
   * ASSUMED endpoint (verify against docs):
   *   POST {base}/payments/{paymentTxnId}/refund
   */
  async refund(input: RefundInput, _shopCredentials: Record<string, unknown>): Promise<RefundResult> {
    const apiKey = TOROPAY_API_KEY();
    if (!apiKey) {
      return { refundId: '', amountPaise: input.amountPaise, status: 'failed' };
    }

    try {
      const res = await fetch(
        `${TOROPAY_API_BASE_URL()}/payments/${input.paymentTxnId}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            amount_paise: input.amountPaise,
            reason: input.reason,
          }),
        },
      );

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'unknown');
        return {
          refundId: '',
          amountPaise: input.amountPaise,
          status: 'failed',
        };
      }

      const data = await res.json() as { id?: string; status?: string; amount_paise?: number };
      return {
        refundId: data.id ?? '',
        amountPaise: data.amount_paise ?? input.amountPaise,
        status: data.status === 'completed' ? 'completed' : 'pending',
      };
    } catch {
      return { refundId: '', amountPaise: input.amountPaise, status: 'failed' };
    }
  }
}

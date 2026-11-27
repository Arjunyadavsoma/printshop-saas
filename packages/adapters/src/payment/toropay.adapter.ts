/**
 * ToroPay payment adapter — UPI payment-link platform.
 *
 * VERIFIED API contract from https://www.toropay.co.in/docs/api-and-mcp:
 *   Base URL: https://www.toropay.co.in/api/v1
 *   Auth: Authorization: Bearer tp_live_... or tp_test_...
 *   Mode header: x-toropay-mode: test | live
 *   Scopes: read (list), write (create, confirm, reject, refund)
 *
 * VERIFIED endpoints:
 *   POST /api/v1/orders              — create order
 *   GET  /api/v1/orders/{id}         — get order
 *   GET  /api/v1/orders/{id}/payment-status — payment status
 *   POST /api/v1/transactions/{id}/confirm  — merchant confirms payment
 *   POST /api/v1/transactions/{id}/reject   — merchant rejects payment
 *   GET/POST /api/v1/refunds         — refunds
 *   GET  /api/v1/transactions        — list transactions
 *
 * VERIFIED payment model from https://www.toropay.co.in/docs/payment-status:
 *   Direct UPI: customer pays → taps "I have paid" (claim) → merchant
 *   confirms via ToroPay dashboard or API → payment.confirmed webhook.
 *   Provider checkout: pending → processing → paid → signed webhook.
 *   Both paths produce payment.confirmed when settled.
 *
 * ENVIRONMENT VARIABLES (server-side only):
 *   TOROPAY_API_KEY        — tp_live_... or tp_test_...
 *   TOROPAY_WEBHOOK_SECRET — HMAC SHA-256 signing secret
 *   TOROPAY_MODE           — "test" | "live"
 *   TOROPAY_RETURN_URL     — URL the customer returns to after payment
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

/** VERIFIED base URL from https://www.toropay.co.in/docs/api-and-mcp */
const TOROPAY_BASE = 'https://www.toropay.co.in/api/v1';
const TOROPAY_API_KEY = () => process.env.TOROPAY_API_KEY ?? '';
const TOROPAY_WEBHOOK_SECRET = () => process.env.TOROPAY_WEBHOOK_SECRET ?? '';
const TOROPAY_MODE = () => process.env.TOROPAY_MODE ?? 'test';
const TOROPAY_RETURN_URL = () => process.env.TOROPAY_RETURN_URL ?? '';

export class ToroPayPaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'toropay';

  /** Common headers for all ToroPay API requests. */
  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOROPAY_API_KEY()}`,
      'x-toropay-mode': TOROPAY_MODE(),
    };
  }

  /**
   * Create a payment order via the ToroPay API.
   * VERIFIED endpoint: POST /api/v1/orders
   *
   * The merchantOrderId (our internal reference) is sent as
   * `merchant_order_id`. ToroPay creates a payment link/order and returns
   * a checkout URL where the customer pays.
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
      throw new Error('TOROPAY_API_KEY is not set. Configure it in the environment.');
    }

    const body = {
      merchant_order_id: input.merchantOrderId,
      amount_paise: input.amountPaise,
      currency: 'INR',
      customer: {
        phone: input.customerPhone ?? undefined,
        name: input.shopName,
      },
      return_url: TOROPAY_RETURN_URL() || undefined,
      description: `Printelyx order ${input.customerToken ?? input.orderId}`,
      upi_id: input.shopUpiId,
    };

    const res = await fetch(`${TOROPAY_BASE}/orders`, {
      method: 'POST',
      headers: this.headers(),
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
   * Poll the ToroPay payment status API.
   * VERIFIED endpoint: GET /api/v1/orders/{id}/payment-status
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
      const orderId = input.gatewayOrderId ?? input.merchantOrderId;
      const res = await fetch(
        `${TOROPAY_BASE}/orders/${orderId}/payment-status`,
        { headers: this.headers() },
      );
      if (!res.ok) {
        return { paid: false, txnId: null, utr: null, amountPaise: null, provider: 'toropay', raw: { status: res.status } };
      }
      const data = await res.json() as {
        status?: string;
        payment?: { txn_id?: string; amount_paise?: number; status?: string };
        amount_paise?: number;
      };
      // VERIFIED statuses: "success" = paid, "failed" = rejected, "initiated"/"pending" = waiting
      const paid = data.status === 'success' || data.payment?.status === 'success' || data.status === 'paid';
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
   * VERIFIED from https://www.toropay.co.in/docs/webhooks:
   *   - X-ToroPay-Signature = hex HMAC-SHA256 of raw body
   *   - X-ToroPay-Event = event type
   *   - Body = { id, type, created_at, data }
   *   - Verify signature against raw body before parsing
   *   - Compare in constant time
   *   - Dedupe on payload id
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

    const { paid, failed } = classifyToroPayEvent(event.type);
    const merchantOrderId = extractMerchantOrderId(event);
    const details = extractPaymentDetails(event);

    const verification: PaymentVerification = {
      paid,
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
      responseBody: JSON.stringify({ received: true, event_id: event.id }),
    };
  }

  /**
   * Initiate a refund via ToroPay.
   * VERIFIED endpoint: POST /api/v1/refunds
   *
   * From docs: "ToroPay does not move refunds" — the refund is recorded
   * but the merchant must action it off-platform. The API records the
   * refund for audit purposes.
   */
  async refund(input: RefundInput, _shopCredentials: Record<string, unknown>): Promise<RefundResult> {
    const apiKey = TOROPAY_API_KEY();
    if (!apiKey) {
      return { refundId: '', amountPaise: input.amountPaise, status: 'failed' };
    }

    try {
      const res = await fetch(`${TOROPAY_BASE}/refunds`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          payment_id: input.paymentTxnId,
          amount_paise: input.amountPaise,
          reason: input.reason,
        }),
      });

      if (!res.ok) {
        return { refundId: '', amountPaise: input.amountPaise, status: 'failed' };
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

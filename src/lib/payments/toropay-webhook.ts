/**
 * ToroPay webhook verification + event processing.
 *
 * VERIFIED API contract from https://www.toropay.co.in/docs/webhooks:
 *   - Header: `X-ToroPay-Event` (event type)
 *   - Header: `X-ToroPay-Signature` (hex HMAC-SHA256 of raw body)
 *   - Body: `{ id, type, created_at, data: {...} }`
 *   - Verify signature against raw body before parsing.
 *   - Compare in constant time.
 *   - Dedupe on payload `id`.
 *
 * VERIFIED payment model from https://www.toropay.co.in/docs/payment-status:
 *   Two pipelines — both produce `payment.confirmed` when settled:
 *   1. Direct UPI: customer pays → taps "I have paid" (claim) → merchant
 *      confirms via ToroPay dashboard → `payment.confirmed` webhook fires.
 *   2. Provider checkout: pending → processing → paid → signed webhook
 *      settles → `payment.confirmed` fires.
 *
 *   In BOTH cases, `payment.confirmed` means the payment IS confirmed.
 *   The order should be auto-finalized when this event arrives with a
 *   valid signature.
 *
 * Events (VERIFIED from docs):
 *   - payment.confirmed → payment confirmed (merchant or provider) → auto-finalize
 *   - payment.rejected → payment rejected → mark failed
 *   - payment.paid → legacy name for payment.confirmed → auto-finalize
 *   - payment.failed → legacy name for payment.rejected → mark failed
 *   - order.paid → order paid → auto-finalize
 *   - order.created, order.updated → informational
 *   - payment_link.created, customer.created → informational
 *   - fulfillment.* → informational (not used by Printelyx — pickup model)
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** VERIFIED ToroPay webhook envelope (from docs: { id, type, created_at, data }). */
interface ToroPayEvent {
  id: string;           // event ID (e.g. "evt_...") — used for dedup
  type: string;         // event type (e.g. "payment.confirmed")
  created_at: string;   // ISO timestamp
  data: {
    order?: {
      id?: string;              // ToroPay's order ID
      merchant_order_id?: string; // Our merchantOrderId (link to PaymentAttempt)
      amount?: number;           // in paise
      currency?: string;         // "INR"
      status?: string;
    };
    payment?: {
      id?: string;               // ToroPay's payment/transaction ID
      txn_id?: string;           // UTR / RRN
      amount?: number;
      currency?: string;
      status?: string;
      method?: string;
    };
  };
}

export interface ToroPayWebhookVerification {
  ok: boolean;
  eventType: string | null;
  eventId: string | null;
  paid: boolean;
  merchantOrderId: string | null;
  providerTxnId: string | null;
  utr: string | null;
  amountPaise: number | null;
  currency: string | null;
  error: string | null;
}

/** Events that indicate a confirmed payment (auto-finalize the order). */
const CONFIRMED_EVENTS = new Set([
  'payment.confirmed',
  'payment.paid',      // legacy name
  'order.paid',
]);

/** Events that indicate a rejected/failed payment. */
const REJECTED_EVENTS = new Set([
  'payment.rejected',
  'payment.failed',    // legacy name
]);

/**
 * Verify the HMAC SHA-256 signature of a ToroPay webhook.
 * Uses `timingSafeEqual` for constant-time comparison.
 */
export function verifyToroPaySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  if (expected.length !== signatureHeader.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Parse + validate a ToroPay webhook event.
 * VERIFIED envelope: { id, type, created_at, data }.
 */
export function parseToroPayEvent(rawBody: string): ToroPayEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as ToroPayEvent;
    if (!parsed.id || !parsed.type) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Classify a ToroPay event.
 * VERIFIED semantics:
 *   - payment.confirmed / payment.paid / order.paid → paid=true (auto-finalize)
 *   - payment.rejected / payment.failed → failed=true
 *   - All other events → informational (no state change)
 */
export function classifyToroPayEvent(
  eventType: string,
): { paid: boolean; failed: boolean } {
  if (CONFIRMED_EVENTS.has(eventType)) {
    return { paid: true, failed: false };
  }
  if (REJECTED_EVENTS.has(eventType)) {
    return { paid: false, failed: true };
  }
  return { paid: false, failed: false };
}

/**
 * Extract the merchant order reference from a ToroPay event.
 */
export function extractMerchantOrderId(event: ToroPayEvent): string | null {
  return event.data?.order?.merchant_order_id ?? event.data?.order?.id ?? null;
}

/**
 * Extract payment verification details from a ToroPay event.
 */
export function extractPaymentDetails(event: ToroPayEvent): {
  providerTxnId: string | null;
  utr: string | null;
  amountPaise: number | null;
  currency: string | null;
} {
  const order = event.data?.order;
  const payment = event.data?.payment;
  return {
    providerTxnId: payment?.id ?? order?.id ?? null,
    utr: payment?.txn_id ?? null,
    amountPaise: payment?.amount ?? order?.amount ?? null,
    currency: payment?.currency ?? order?.currency ?? null,
  };
}

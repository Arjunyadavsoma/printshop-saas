/**
 * ToroPay webhook verification + event processing.
 *
 * ToroPay (https://www.toropay.co.in/) is a UPI payment-link platform.
 * The webhook contract is documented at https://www.toropay.co.in/docs:
 *   - Header: `X-ToroPay-Event` (event type)
 *   - Header: `X-ToroPay-Signature` (HMAC SHA-256 hex of the raw body)
 *   - Body: JSON envelope `{ event_id, event_type, created_at, data: {...} }`
 *
 * Two payment paths exist:
 *   1. **Direct UPI** — the customer pays the merchant's own UPI ID directly.
 *      ToroPay sends a `payment.paid` event, but the merchant MUST still
 *      confirm receipt. The platform treats this as "pending merchant
 *      verification" — it does NOT auto-finalize the order.
 *   2. **Provider checkout** — ToroPay orchestrates a hosted checkout via
 *      Razorpay/Cashfree. A `payment.confirmed` event with a valid signature
 *      settles the payment — the order IS auto-finalized.
 *
 * Security:
 *   - Raw body bytes are read BEFORE JSON parsing (signature covers exact bytes).
 *   - HMAC SHA-256 verified with `timingSafeEqual` (constant-time comparison).
 *   - Event ID stored with a UNIQUE constraint — duplicate delivery is a no-op.
 *   - Amount + currency + order reference validated against the stored order.
 *   - A paid payment is NEVER moved backwards by a delayed failure event.
 *
 * API contract assumptions (NEED VERIFICATION against https://www.toropay.co.in/docs):
 *   - API base URL: `https://api.toropay.co.in/v1` (ASSUMED — verify in docs)
 *   - Auth: `Authorization: Bearer <api_key>` (ASSUMED — verify in docs)
 *   - Order creation: `POST /orders` (ASSUMED — verify in docs)
 *   - Status lookup: `GET /orders/{id}` (ASSUMED — verify in docs)
 *   These assumptions are clearly marked in docs/PRINTELYX-TOROPAY-API-CONTRACT.md.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** Verified ToroPay webhook envelope. */
interface ToroPayEvent {
  event_id: string;
  event_type: string;
  created_at: number; // unix timestamp
  data: {
    order?: {
      id?: string;          // ToroPay's order ID
      merchant_order_id?: string; // Our merchantOrderId (the link to our PaymentAttempt)
      amount?: number;       // in paise (verify — could be rupees)
      currency?: string;     // "INR"
      status?: string;       // "paid" | "pending" | "failed" | etc.
    };
    payment?: {
      id?: string;           // ToroPay's payment ID
      txn_id?: string;       // UTR / RRN
      amount?: number;
      currency?: string;
      status?: string;       // "confirmed" | "rejected" | "paid" | "failed"
      method?: string;       // "upi" | "card" | etc.
    };
  };
}

export interface ToroPayWebhookVerification {
  ok: boolean;
  eventType: string | null;
  eventId: string | null;
  paid: boolean;
  /** "direct_upi" = merchant must confirm; "provider_checkout" = auto-finalize */
  settlementMode: 'direct_upi' | 'provider_checkout' | null;
  merchantOrderId: string | null;
  providerTxnId: string | null;
  utr: string | null;
  amountPaise: number | null;
  currency: string | null;
  error: string | null;
}

/** Events that indicate a successful payment (provider checkout path). */
const PAID_EVENTS = new Set(['payment.confirmed', 'payment.paid', 'order.paid']);

/** Events that indicate a failed payment. */
const FAILED_EVENTS = new Set(['payment.rejected', 'payment.failed']);

/** Events that indicate direct UPI (merchant must verify). */
const DIRECT_UPI_EVENTS = new Set(['payment.paid', 'order.paid']);

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
  // Both must be the same length for timingSafeEqual.
  if (expected.length !== signatureHeader.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Parse + validate a ToroPay webhook event.
 * Returns the verified event data or an error.
 */
export function parseToroPayEvent(rawBody: string): ToroPayEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as ToroPayEvent;
    if (!parsed.event_id || !parsed.event_type) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Determine whether a ToroPay event settles a payment (provider checkout)
 * or requires merchant verification (direct UPI).
 *
 * - `payment.confirmed` → provider checkout, auto-finalize.
 * - `payment.paid` / `order.paid` → direct UPI, merchant must confirm.
 * - `payment.rejected` / `payment.failed` → failed, do not finalize.
 * - Other events → informational, no state change.
 */
export function classifyToroPayEvent(
  eventType: string,
): { paid: boolean; failed: boolean; settlementMode: 'direct_upi' | 'provider_checkout' | null } {
  if (eventType === 'payment.confirmed') {
    return { paid: true, failed: false, settlementMode: 'provider_checkout' };
  }
  if (DIRECT_UPI_EVENTS.has(eventType)) {
    return { paid: false, failed: false, settlementMode: 'direct_upi' };
  }
  if (FAILED_EVENTS.has(eventType)) {
    return { paid: false, failed: true, settlementMode: null };
  }
  return { paid: false, failed: false, settlementMode: null };
}

/**
 * Extract the merchant order reference from a ToroPay event.
 * This is the link between the ToroPay payment and our PaymentAttempt.
 */
export function extractMerchantOrderId(event: ToroPayEvent): string | null {
  return event.data?.order?.merchant_order_id ?? event.data?.payment?.id ?? null;
}

/**
 * Extract the payment verification details from a ToroPay event.
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

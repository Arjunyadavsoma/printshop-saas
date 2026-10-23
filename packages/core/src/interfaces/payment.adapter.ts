import type { PaymentProvider } from '../domain';

/**
 * Payment provider abstraction.
 *
 * **Critical**: money flows **directly** to the shopkeeper's own merchant /
 * UPI account. The platform takes **zero commission**. Each shop configures
 * exactly one provider; the adapter routes to the correct implementation.
 *
 * All amounts are integer paise (1 INR = 100 paise). Never floats.
 *
 * Concrete implementations:
 *  - `PhonePePaymentAdapter`     (server-to-server webhook, recommended)
 *  - `PaytmPaymentAdapter`       (checksum-verified callback)
 *  - `UpiDeepLinkPaymentAdapter`  (zero-onboarding fallback: upi:// URIs)
 *  - `RazorpayPaymentAdapter`    (roadmap: "easy button" KYC)
 *  - `StubPaymentAdapter`        (tests)
 */

/** A payment intent the client uses to complete the transaction. */
export interface PaymentIntent {
  /** Our own id, reused as the merchant order id. */
  merchantOrderId: string;
  /** The order this payment is for. */
  orderId: string;
  /** Paise the customer must pay. */
  amountPaise: number;
  currency: string; // ISO 4217, "INR"
  /** Where to send the customer to actually pay. */
  checkoutUrl?: string;
  /** For UPI deep-link: a `upi://pay?...` URI the frontend can navigate to. */
  upiUri?: string;
  /** NPCI-compliant QR payload string (render as QR on desktop). */
  qrPayload?: string;
  provider: PaymentProvider;
  /** ISO datetime when this intent expires. */
  expiresAt: Date;
}

/** Verification result of a webhook or status-poll call. */
export interface PaymentVerification {
  paid: boolean;
  /** PSP's transaction id — `UNIQUE` constraint prevents replay. */
  txnId: string | null;
  /** UTR / RRN printed on the customer's bank statement. */
  utr: string | null;
  amountPaise: number | null;
  provider: PaymentProvider;
  /** Raw, unmodified payload (logged to audit_logs before processing). */
  raw: unknown;
}

/** Webhook request handed to the adapter for signature verification. */
export interface WebhookInput {
  /** Raw body bytes — signatures must cover the exact bytes received. */
  rawBody: string;
  headers: Record<string, string>;
  /** Path the webhook arrived on, e.g. `/api/v1/payments/phonepe/webhook`. */
  path: string;
}

/** Strongly-typed webhook result so the route can short-circuit. */
export interface WebhookResult {
  ok: boolean;
  verification: PaymentVerification | null;
  /** HTTP status the API should reply with. */
  statusCode: number;
  /** Optional body the PSP expects back (Paytm wants an HTML page). */
  responseBody?: string;
}

export interface RefundInput {
  paymentTxnId: string;
  amountPaise: number;
  reason: string;
}

export interface RefundResult {
  refundId: string;
  amountPaise: number;
  status: 'pending' | 'completed' | 'failed';
}

export interface PaymentAdapter {
  readonly provider: PaymentProvider;

  /**
   * Create a payment intent for an order. Generates a unique
   * `merchantOrderId` per attempt so retries don't collide.
   */
  createPaymentIntent(input: {
    orderId: string;
    amountPaise: number;
    customerPhone?: string;
    shopUpiId: string;
    /** The shop's display name — used as the UPI payee name (`pn`). */
    shopName?: string;
    /** The order's customer-facing token (e.g. "B5EY7Y") — used in the
     * transaction note (`tn`) so the customer + shopkeeper can reconcile. */
    customerToken?: string;
    shopCredentials: Record<string, unknown>;
  }): Promise<PaymentIntent>;

  /**
   * Poll the PSP status API. Used as a fallback when webhooks are delayed
   * or absent (the UPI deep-link path).
   */
  verifyPayment(input: {
    merchantOrderId: string;
    shopCredentials: Record<string, unknown>;
  }): Promise<PaymentVerification>;

  /**
   * Verify + parse an inbound webhook. MUST be idempotent — receiving the
   * same event twice must not double-credit the order.
   */
  handleWebhook(input: WebhookInput, shopCredentials: Record<string, unknown>): Promise<WebhookResult>;

  /** Initiate a refund. May be a no-op for the UPI deep-link adapter. */
  refund(input: RefundInput, shopCredentials: Record<string, unknown>): Promise<RefundResult>;
}

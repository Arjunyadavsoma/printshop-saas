import type {
  PaymentAdapter,
  PaymentIntent,
  PaymentVerification,
  RefundResult,
  RefundInput,
  WebhookInput,
  WebhookResult,
} from '@platform/core/interfaces';
import type { PaymentProvider } from '@platform/core/domain';

/**
 * PhonePe adapter (recommended primary).
 *
 * PHASE-1 STATUS: skeleton — interface complete, SDK wiring lands in Phase 3.
 * Signature verification via client.validateCallback() must happen before any
 * state transition; every webhook is logged to audit_logs first.
 */
export class PhonePePaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'phonepe';
  constructor(
    private readonly config: { saltKey: string; saltIndex: string; env: 'prod' | 'sandbox' },
  ) {}

  async createPaymentIntent(): Promise<PaymentIntent> {
    throw new Error('PhonePePaymentAdapter: not implemented until Phase 3');
  }
  async verifyPayment(): Promise<PaymentVerification> {
    throw new Error('PhonePePaymentAdapter: not implemented until Phase 3');
  }
  async handleWebhook(_input: WebhookInput): Promise<WebhookResult> {
    throw new Error('PhonePePaymentAdapter: not implemented until Phase 3');
  }
  async refund(_input: RefundInput): Promise<RefundResult> {
    throw new Error('PhonePePaymentAdapter: not implemented until Phase 3');
  }
}

/**
 * UPI deep-link adapter (zero-onboarding fallback).
 *
 * Generates a `upi://pay?...` URI from the shopkeeper's own VPA. On desktop,
 * render the payload as an NPCI-compliant QR. Confirmation is via polling
 * the PSP status API (Phase 3).
 */
export class UpiDeepLinkPaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'googlepay';

  /** Build a `upi://pay?` URI from the shopkeeper's VPA + amount. */
  async createPaymentIntent(input: {
    orderId: string;
    amountPaise: number;
    shopUpiId: string;
  }): Promise<PaymentIntent> {
    const params = new URLSearchParams({
      pa: input.shopUpiId,
      am: (input.amountPaise / 100).toFixed(2),
      pn: 'PrintShop',
      tn: `Order ${input.orderId.slice(0, 8)}`,
      tr: input.orderId,
      cu: 'INR',
    });
    const upiUri = `upi://pay?${params.toString()}`;
    return {
      merchantOrderId: input.orderId,
      orderId: input.orderId,
      amountPaise: input.amountPaise,
      currency: 'INR',
      upiUri,
      qrPayload: upiUri,
      provider: 'googlepay',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  async verifyPayment(): Promise<PaymentVerification> {
    // Real confirmation: poll the PSP status API / parse SMS. Phase 3.
    return {
      paid: false,
      txnId: null,
      utr: null,
      amountPaise: null,
      provider: 'googlepay',
      raw: null,
    };
  }
  async handleWebhook(): Promise<WebhookResult> {
    return { ok: false, verification: null, statusCode: 404 };
  }
  async refund(): Promise<RefundResult> {
    return { refundId: 'n/a', amountPaise: 0, status: 'failed' };
  }
}

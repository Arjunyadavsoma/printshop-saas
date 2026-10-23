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
 * UPI deep-link adapter — the "zero onboarding" fallback.
 *
 * Generates a `upi://pay?...` URI from the shopkeeper's own VPA. On desktop,
 * render the payload as an NPCI-compliant QR. Confirmation is via polling
 * the PSP status API (Phase 3) or the dev mark-paid route in the demo.
 */
export class UpiDeepLinkPaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'googlepay';

  /** Build a `upi://pay?` URI from the shopkeeper's VPA + amount + name. */
  async createPaymentIntent(input: {
    orderId: string;
    amountPaise: number;
    customerPhone?: string;
    shopUpiId: string;
    shopName?: string;
    customerToken?: string;
    shopCredentials: Record<string, unknown>;
  }): Promise<PaymentIntent> {
    // UPI deep-link per NPCI BHIM spec:
    //   pa = Payee Address (the shop's VPA, e.g. quickprint@okaxis)
    //   pn = Payee Name (the shop's display name — shown in the UPI app)
    //   am = Amount in rupees (2 decimal places)
    //   cu = Currency (INR)
    //   tn = Transaction Note (shown in the UPI app's payment confirmation)
    //   tr = Transaction Reference (unique per order — used for reconciliation)
    //
    // URLSearchParams.toString() URL-encodes every value per RFC 3986 — safe
    // for the `upi://` scheme. No unescaped user-controlled values are
    // concatenated into the URI.
    const params = new URLSearchParams({
      pa: input.shopUpiId,
      pn: input.shopName ?? 'PrintShop',
      am: (input.amountPaise / 100).toFixed(2),
      cu: 'INR',
      tn: input.customerToken
        ? `PrintShop order ${input.customerToken}`
        : `PrintShop order ${input.orderId.slice(0, 8)}`,
      tr: input.customerToken ?? input.orderId,
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

  async verifyPayment(input: {
    merchantOrderId: string;
    shopCredentials: Record<string, unknown>;
  }): Promise<PaymentVerification> {
    // Real confirmation: poll the PSP status API / parse SMS. Phase 3.
    void input.shopCredentials;
    void input.merchantOrderId;
    return {
      paid: false,
      txnId: null,
      utr: null,
      amountPaise: null,
      provider: 'googlepay',
      raw: null,
    };
  }

  /** UPI deep-link has no server-side webhook — status comes via poll. */
  async handleWebhook(_input: WebhookInput): Promise<WebhookResult> {
    return { ok: false, verification: null, statusCode: 404 };
  }

  async refund(_input: RefundInput, _shopCredentials: Record<string, unknown>): Promise<RefundResult> {
    // UPI has no server-side refund; the shopkeeper refunds manually.
    return { refundId: 'n/a', amountPaise: _input.amountPaise, status: 'failed' };
  }
}

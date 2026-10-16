import type { PaymentAdapter } from '@platform/core/interfaces';
import type { PaymentProvider } from '@platform/core/domain';
import { PhonePePaymentAdapter, PaytmPaymentAdapter, UpiDeepLinkPaymentAdapter } from '@platform/adapters';
import { AdapterError } from '@platform/core/errors';

/**
 * Routes to the correct PaymentAdapter concrete by the shop's configured
 * provider. Adding a new provider (e.g. Razorpay) is: implement the adapter,
 * register it here, set PAYMENT_PROVIDER. No business-logic changes.
 */
export class PaymentAdapterRegistry {
  private adapters = new Map<PaymentProvider, PaymentAdapter>();

  constructor() {
    this.register(new PhonePePaymentAdapter());
    this.register(new PaytmPaymentAdapter());
    this.register(new UpiDeepLinkPaymentAdapter());
  }

  register(adapter: PaymentAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: PaymentProvider): PaymentAdapter {
    const a = this.adapters.get(provider);
    if (!a) throw new AdapterError('payment-registry', `No adapter registered for '${provider}'`);
    return a;
  }

  providers(): PaymentProvider[] {
    return [...this.adapters.keys()];
  }
}

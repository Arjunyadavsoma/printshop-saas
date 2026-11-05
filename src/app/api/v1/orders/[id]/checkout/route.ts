import { type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { rememberPaymentSession } from '@/lib/payments/webhook.service';

/** POST /api/v1/orders/:id/checkout — create a payment intent (provider = shop's).
 *
 * SEC-001 fix: behind withOrderAccess — caller must present the order's
 * `customerToken` before a payment intent is minted. Previously anyone
 * who learned the order UUID could create payment intents for another
 * customer's order, polluting their checkout state. */
export const POST = withRateLimit<{ id: string }>(
  'checkout',
  20,
  60,
  withOrderAccess<{ id: string }>(async (req, _ctx, order) => {
    try {
    if (order.status !== 'awaiting_payment') {
      throw new ValidationError(`Order in status '${order.status}' cannot be checked out`);
    }

    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');
    if (!shop.upiId) throw new ValidationError('Shop has no UPI VPA configured');

    const files = await repos.files.findByOrder(order.id);
    if (files.length === 0) throw new ValidationError('Cannot checkout an order with no files');
    const unpaid = files.filter((f) => f.pricePaise === 0);
    if (unpaid.length > 0) {
      throw new ValidationError(`${unpaid.length} file(s) have no price — set print settings first`);
    }

    const container = getContainer();
    // Route to the shop's configured provider via the registry.
    const adapter = container.paymentRegistry.get(shop.paymentProvider);
    const intent = await adapter.createPaymentIntent({
      orderId: order.id,
      amountPaise: order.totalAmountPaise,
      shopUpiId: shop.upiId,
      shopName: shop.name,
      customerToken: order.customerToken,
      shopCredentials: shop.paymentCredentials,
    });

    // FALLBACK: if the provider adapter didn't return a upiUri (e.g. PhonePe
    // API failed, Paytm API failed, or the adapter returned a degraded
    // intent without a checkoutUrl), generate a UPI deep-link URI from the
    // shop's UPI ID so the customer can ALWAYS pay via UPI app or QR scan.
    // This ensures the payment step always has working UPI payment options.
    if (!intent.upiUri && shop.upiId) {
      const upiParams = new URLSearchParams();
      upiParams.set('pa', shop.upiId);
      upiParams.set('pn', shop.name);
      upiParams.set('am', (order.totalAmountPaise / 100).toFixed(2));
      upiParams.set('cu', 'INR');
      upiParams.set('tn', order.customerToken);
      upiParams.set('tr', intent.merchantOrderId);
      const fallbackUpiUri = `upi://pay?${upiParams.toString()}`;
      intent.upiUri = fallbackUpiUri;
      intent.qrPayload = fallbackUpiUri;
    }

    // Remember the merchantOrderId → order mapping so the (later) webhook can
    // find the order + shop's credentials without trusting the payload.
    await rememberPaymentSession(intent.merchantOrderId, {
      orderId: order.id,
      shopId: shop.id,
      amountPaise: order.totalAmountPaise,
      provider: shop.paymentProvider,
    });

    await repos.audit.log({
      shopId: shop.id,
      userId: null,
      action: 'order.checkout',
      entityType: 'order',
      entityId: order.id,
      metadata: { amountPaise: order.totalAmountPaise, provider: intent.provider, merchantOrderId: intent.merchantOrderId },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      orderId: order.id,
      merchantOrderId: intent.merchantOrderId,
      amountPaise: intent.amountPaise,
      currency: intent.currency,
      provider: intent.provider,
      checkoutUrl: intent.checkoutUrl,
      upiUri: intent.upiUri,
      qrPayload: intent.qrPayload,
      expiresAt: intent.expiresAt,
    });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  }),
);

import { type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { rememberPaymentSession } from '@/lib/payments/webhook.service';

/** POST /api/v1/orders/:id/checkout — create a payment intent (provider = shop's). */
export const POST = withRateLimit<{ id: string }>('checkout', 20, 60, async (req, ctx) => {
  try {
    const { id } = await ctx.params;
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
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
      shopCredentials: shop.paymentCredentials,
    });

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
});

import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { repos } from '@/lib/repositories';
import { NotFoundError } from '@platform/core/errors';
import { initiateRefund } from '@/lib/payments/refund.service';

/**
 * POST /api/v1/shops/me/orders/:id/refund
 *
 * Shopkeeper-initiated refund. Owner-only (staff cannot refund — financial
 * action). Reuses the existing provider adapters' `refund()` methods for
 * gateway orders (Razorpay/PhonePe/Paytm); for direct-UPI orders the refund
 * is recorded as `manual` (the shopkeeper actions it off-platform via UPI).
 *
 * Idempotency: the Refund table has `@@unique([provider, providerRefundId])`
 * and the service checks the un-refunded balance before initiating. A
 * duplicate request for the same amount on a fully-refunded order is
 * rejected with a clear message.
 *
 * The order is NOT automatically cancelled — the shopkeeper may refund a
 * partial amount or refund after collection. The refund is tracked on the
 * Refund model + Payment.status='REFUNDED_NOTE' (full refund only).
 *
 * Security: provider secrets are NEVER exposed. The adapter receives the
 * encrypted `shop.paymentCredentials` blob and decrypts internally. The
 * response only contains the refund ID + provider reference (which is safe
 * to share — it's the customer-facing refund reference).
 */
const RefundSchema = z.object({
  amountPaise: z.number().int().positive('Refund amount must be positive'),
  reason: z.string().min(1).max(500, 'Reason must be under 500 characters'),
});

export const POST = withAuth<{ id: string }>(
  async (req, ctx, principal) => {
    try {
      const { id } = await ctx.params;
      const body = RefundSchema.parse(await req.json());

      const shop = await repos.shops.getByOwner(principal.userId);
      const order = await repos.orders.findByIdAndShop(id, shop.id);
      if (!order) throw new NotFoundError('Order not found');

      const result = await initiateRefund({
        orderId: order.id,
        shopId: shop.id,
        initiatedBy: principal.userId,
        amountPaise: body.amountPaise,
        reason: body.reason,
      });

      return ok(result);
    } catch (cause) {
      // toAppError maps ValidationError → 400, NotFoundError → 404, etc.
      return fail(toAppError(cause));
    }
  },
  ['owner'], // Owner-only — staff cannot refund
);

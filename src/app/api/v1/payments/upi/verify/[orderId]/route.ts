import { type NextRequest } from 'next/server';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/payments/upi/verify/:orderId — fallback status check.
 *
 * UPI deep-link has no server-side webhook, so the customer-status poller
 * relies on this: it consults our own DB (which the PSP webhook or the
 * dev mark-paid route updates). In Phase 3 this consults the PSP status API.
 */
export const GET = withRateLimit<{ orderId: string }>('upi-verify', 60, 60, async (_req, ctx) => {
  try {
    const { orderId } = await ctx.params;
    const order = await repos.orders.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');
    const paid = ['paid', 'printing', 'ready', 'collected'].includes(order.status);
    return ok({
      paid,
      txnId: order.paymentTxnId,
      utr: order.paymentUtr,
      amountPaise: paid ? order.totalAmountPaise : null,
      status: order.status,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

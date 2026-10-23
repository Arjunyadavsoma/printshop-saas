import { type NextRequest } from 'next/server';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';
import { formatINRFromPaise } from '@platform/utils';

/** GET /api/v1/orders/:id/status — poll payment + print status. */
export const GET = withRateLimit<{ id: string }>('status', 120, 60, async (_req, ctx) => {
  try {
    const { id } = await ctx.params;
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');

    const files = await repos.files.findByOrder(order.id);
    // `tokenNumber` is the per-shop sequential token (e.g. "A001") — the SAME
    // token the shopkeeper sees in their dashboard. Including it here lets the
    // customer tracking page show the SAME token as the shopkeeper, so both
    // parties can reference the order by the same number.
    // `customerToken` (e.g. "B5EY7Y") is still returned for backward compat
    // (the customer may have written it down before the tokenNumber existed).
    // `paidAt` + `paymentTxnId` let the customer UI show a separate payment
    // status indicator (green checkmark when confirmed, pending when null).
    return ok({
      orderId: order.id,
      customerToken: order.customerToken,
      tokenNumber: order.tokenNumber,
      status: order.status,
      totalAmountPaise: order.totalAmountPaise,
      totalFormatted: formatINRFromPaise(order.totalAmountPaise),
      currency: order.currency,
      paidAt: order.paidAt,
      paymentTxnId: order.paymentTxnId,
      paymentUtr: order.paymentUtr,
      files: files.map((f) => ({
        id: f.id,
        filename: f.originalFilename,
        status: f.status,
        copies: f.copies,
        colorMode: f.colorMode,
        duplex: f.duplex,
        printedAt: f.printedAt,
      })),
      updatedAt: order.updatedAt,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

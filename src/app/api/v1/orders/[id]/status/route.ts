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
    return ok({
      orderId: order.id,
      customerToken: order.customerToken,
      status: order.status,
      totalAmountPaise: order.totalAmountPaise,
      totalFormatted: formatINRFromPaise(order.totalAmountPaise),
      currency: order.currency,
      paidAt: order.paidAt,
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

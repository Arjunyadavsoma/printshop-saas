import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';

const MarkPaidSchema = z.object({
  utr: z.string().min(6).max(30).optional(),
});

/**
 * POST /api/v1/dev/orders/:id/mark-paid — simulate a PSP webhook callback.
 * Flips the order to `paid` with a synthetic UTR. DEV-ONLY: in production the
 * real PhonePe/Paytm webhook handlers (Phase 3) do this after signature
 * verification. Provided here so the demo can exercise the full lifecycle.
 */
export const POST = withRateLimit<{ id: string }>('mark-paid', 20, 60, async (req, ctx) => {
  try {
    const { id } = await ctx.params;
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
    if (!canTransitionOrder(order.status, 'paid')) {
      throw new ValidationError(`Order in status '${order.status}' cannot be marked paid`);
    }
    const body = MarkPaidSchema.parse(await req.json().catch(() => ({})));
    const utr = body.utr ?? `DEMO${Date.now()}`;

    await repos.orders.update(order.id, {
      status: 'paid',
      paidAt: new Date(),
      paymentUtr: utr,
      paymentTxnId: `txn_${crypto.randomUUID()}`,
      paymentProvider: order.paymentProvider ?? 'googlepay',
    });

    await repos.audit.log({
      shopId: order.shopId,
      userId: null,
      action: 'order.paid',
      entityType: 'order',
      entityId: order.id,
      metadata: { utr, source: 'dev-mark-paid' },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      orderId: order.id,
      status: 'paid',
      paidAt: new Date(),
      paymentUtr: utr,
      devOnly: true,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

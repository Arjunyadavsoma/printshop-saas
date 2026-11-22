import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { requireDev } from '@/lib/api/require-dev';
import { withRateLimit } from '@/lib/api/with-auth';
import { applyPaymentTransition } from '@/lib/payments/lifecycle.service';
import { enqueuePaidOrderPrint } from '@/lib/payments/webhook.service';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';

/**
 * POST /api/v1/payments/dev/razorpay/simulate — DEV ONLY. Marks a checkout
 * attempt as paid WITHOUT a real Razorpay call (no network in tests/CI).
 * Still goes through applyPaymentTransition (atomic + idempotent) and the
 * print enqueue — the only thing skipped is the PSP round-trip.
 */
const SimSchema = z.object({
  merchantOrderId: z.string().uuid(),
  outcome: z.enum(['paid', 'failed']).default('paid'),
});

export const POST = withRateLimit('checkout', 30, 60, async (req: NextRequest) => {
  const blocked = requireDev();
  if (blocked) return blocked;
  try {
    const body = SimSchema.parse(await req.json());
    const db = getContainer().db as unknown as {
      paymentAttempt: { findUnique: (a: { where: { merchantOrderId: string } }) => Promise<{ id: string; orderId: string; shopId: string; amountPaise: number } | null> };
    };
    const attempt = await db.paymentAttempt.findUnique({ where: { merchantOrderId: body.merchantOrderId } });
    if (!attempt) return fail(toAppError(new Error('Unknown merchantOrderId')));
    const order = await repos.orders.findById(attempt.orderId);
    if (!order) return fail(toAppError(new Error('Order not found')));
    const txnId = `sim_rzp_${Date.now()}`;
    const result = await applyPaymentTransition({
      merchantOrderId: body.merchantOrderId,
      provider: 'razorpay',
      providerTxnId: txnId,
      providerUtr: txnId,
      amountPaise: attempt.amountPaise,
      currency: 'INR',
      paid: body.outcome === 'paid',
      eventId: `sim:${txnId}`,
      source: 'webhook',
      shopId: attempt.shopId,
      orderId: attempt.orderId,
    });
    if (result.applied && body.outcome === 'paid') {
      enqueuePaidOrderPrint(attempt.orderId, attempt.shopId);
    }
    return ok({ applied: result.applied, reason: result.reason, outcome: body.outcome, orderId: attempt.orderId });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

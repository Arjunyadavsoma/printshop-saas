import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';

const VerifyPaymentSchema = z.object({
  action: z.enum(['verify', 'reject']),
  txnReference: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
});

/**
 * POST /api/v1/shops/me/orders/:id/verify-payment
 *
 * Shopkeeper-facing manual payment verification. When a customer pays via
 * UPI QR / cash / off-platform, the order sits in `awaiting_payment`. The
 * shopkeeper reviews their bank/UPI app and either verifies (transitions to
 * `paid`) or rejects (stays `awaiting_payment`, with a note for the audit
 * trail so a future reconcile can see why).
 *
 * Only `owner` role can call this — staff/admins use other paths.
 *
 * On verify:
 *   - status: `awaiting_payment` → `paid`
 *   - paymentTxnId: a synthetic manual-txn id ("manual-<uuid>")
 *   - paymentUtr: the shopkeeper-supplied txnReference (UTR/RRN)
 *   - paidAt: now
 *
 * On reject:
 *   - status stays `awaiting_payment`
 *   - notes is appended (or set) with the rejection note for the audit trail
 */
export const POST = withAuth<{ id: string }>(
  async (req, ctx, principal) => {
    const { id } = await ctx.params;
    const body = VerifyPaymentSchema.parse(await req.json());

    const shop = await repos.shops.getByOwner(principal.userId);
    const order = await repos.orders.findByIdAndShop(id, shop.id);
    if (!order) throw new NotFoundError('Order not found');

    if (body.action === 'verify') {
      if (!canTransitionOrder(order.status, 'paid')) {
        throw new ValidationError(
          `Order in status '${order.status}' cannot be manually verified as paid`,
        );
      }
      const txnId = `manual-${crypto.randomUUID()}`;
      const updated = await repos.orders.update(order.id, {
        status: 'paid',
        paymentProvider: 'googlepay',
        paymentTxnId: txnId,
        paymentUtr: body.txnReference ?? null,
        paidAt: new Date(),
      });
      await repos.audit.log({
        shopId: shop.id,
        userId: principal.userId,
        action: 'order.payment.verify',
        entityType: 'order',
        entityId: order.id,
        metadata: {
          action: 'verify',
          paymentTxnId: txnId,
          paymentUtr: body.txnReference ?? null,
          note: body.note ?? null,
        },
        ip: req.headers.get('x-forwarded-for') ?? null,
      });
      return ok(updated);
    }

    // Reject — stay in awaiting_payment but record the reason on the order
    // (in `notes`, prefixed so it's distinguishable from customer notes).
    const rejectNote = body.note ?? 'Payment could not be verified';
    const newNotes = order.notes
      ? `${order.notes}\n[shopkeeper-reject] ${rejectNote}`
      : `[shopkeeper-reject] ${rejectNote}`;
    const updated = await repos.orders.update(order.id, { notes: newNotes });
    await repos.audit.log({
      shopId: shop.id,
      userId: principal.userId,
      action: 'order.payment.reject',
      entityType: 'order',
      entityId: order.id,
      metadata: {
        action: 'reject',
        txnReference: body.txnReference ?? null,
        note: rejectNote,
      },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });
    return ok(updated);
  },
  ['owner'],
);

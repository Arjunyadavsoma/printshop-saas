import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError, ValidationError, ForbiddenError } from '@platform/core/errors';

const ClaimSchema = z.object({
  orderId: z.string().uuid(),
  customerPhone: z.string().max(20).optional(),
});

/**
 * POST /api/v1/me/orders/claim — associate a guest order with the
 * logged-in customer account.
 *
 * Identity correctness (Phase 4):
 * - The customer must be logged in (role='customer').
 * - The order must currently have `customerAccountId = null` (it was
 *   placed as a guest).
 * - The claim is verified by one of:
 *   1. The order's `customerPhone` matches the customer's verified
 *      phone (and `phoneVerified === true` on the account), OR
 *   2. The order was created with the customer's email (future —
 *      requires adding `customerEmail` to the Order model; for now,
 *      phone is the verification channel).
 * - We do NOT auto-merge by phone — the customer must explicitly claim
 *   each order. Multiple accounts may share a phone; only the
 *   account that placed the order (verified by phone match) can
 *   claim it.
 * - Idempotent: claiming an already-claimed order by the SAME account
 *   is a no-op; claiming by a DIFFERENT account is rejected (409).
 *
 * Authorization: role='customer'. The principal's userId is the
 * CustomerAccount.id.
 */
export const POST = withAuth(async (req, _ctx, principal) => {
  try {
    if (principal.role !== 'customer') {
      return fail(new ForbiddenError('Forbidden: customer role required'));
    }
    const body = ClaimSchema.parse(await req.json());
    const accountId = principal.userId;

    const order = await repos.orders.findById(body.orderId);
    if (!order) throw new NotFoundError('Order not found');

    // Already claimed by this same account → idempotent no-op.
    if (order.customerAccountId === accountId) {
      return ok({ ok: true, orderId: order.id, alreadyClaimed: true });
    }
    // Already claimed by a different account → reject.
    if (order.customerAccountId && order.customerAccountId !== accountId) {
      throw new ValidationError('Order is already claimed by another account');
    }

    // Verification: the customer's verified phone must match the
    // order's customerPhone. We do NOT trust the request body's
    // `customerPhone` — we read the account's verified phone from the
    // DB (the source of truth).
    const account = await repos.customerAccounts.findById(accountId);
    if (!account) throw new NotFoundError('Account not found');

    if (!account.phoneVerified || !account.phone) {
      throw new ValidationError('Phone number must be verified before claiming orders');
    }
    if (!order.customerPhone || order.customerPhone !== account.phone) {
      // Mismatch — do NOT reveal which side is wrong (avoid leaking
      // the order's customerPhone to an attacker).
      throw new ValidationError('Order cannot be claimed by this account');
    }

    // Link the order to the account.
    await repos.orders.update(order.id, { customerAccountId: accountId });

    await repos.audit.log({
      shopId: order.shopId,
      userId: null,
      action: 'customer.claim_order',
      entityType: 'order',
      entityId: order.id,
      metadata: { customerAccountId: accountId },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({ ok: true, orderId: order.id, alreadyClaimed: false });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['customer']);

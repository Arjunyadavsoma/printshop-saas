import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';
import { getContainer } from '@/lib/container';

/**
 * POST /api/v1/shops/me/orders/:id/complete — mark collected + delete files.
 *
 * ARCH-011 fix (race-safe + privacy-preserving):
 *
 * PREVIOUS BUG: the order was flipped to 'collected' BEFORE
 * `storage.deleteMany` (which deletes the uploaded files). If deleteMany
 * threw (R2/S3 outage, network glitch), the route returned 500 but the
 * order was ALREADY 'collected' in the DB → the customer's files
 * persisted in the bucket with no metadata pointer (orphaned bytes —
 * privacy violation).
 *
 * FIX:
 *   1. Delete the files FIRST. `storage.deleteMany` is idempotent (a
 *      retry after a partial failure deletes the remaining keys + is a
 *      no-op for the already-deleted ones). If deleteMany throws, the
 *      order stays in its current state ('ready') and the shopkeeper
 *      can retry — no orphaned bytes, no premature 'collected' marker.
 *   2. Flip the order status with a race-safe conditional update
 *      (`transitionStatus` with `expectedCurrentStatus=order.status`).
 *      The `canTransitionOrder` check above already verified the order's
 *      current status is a valid `from` state for 'collected' (per the
 *      state machine at packages/core/src/domain/order.ts, currently
 *      only 'ready'). If a concurrent request (e.g. /cancel) flipped
 *      the status between our fetch + the update, the conditional
 *      update is a no-op (0 rows matched) → we throw a ValidationError
 *      so the shopkeeper re-fetches + retries. The files are already
 *      deleted (idempotent — a retry is safe; the second deleteMany is
 *      a no-op).
 *   3. Audit-log AFTER the successful flip (so the audit trail matches
 *      the actual state transition — no audit entry for a no-op flip).
 *
 * The 60-second print-agent window is the agent's responsibility; here
 * we delete the stored blobs immediately and leave the metadata for the
 * audit trail.
 */
export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'collected')) {
    throw new ValidationError(`Order in status '${order.status}' cannot be marked collected`);
  }

  // STEP 1 — delete the files FIRST (idempotent). If this throws, the
  // order stays in 'ready' and the shopkeeper can retry — no orphaned
  // bytes, no premature 'collected' marker.
  const files = await repos.files.findByOrder(order.id);
  const storage = getContainer().storage;
  await storage.deleteMany(files.map((f) => f.storageKey));

  // STEP 2 — race-safe conditional flip. `order.status` is the freshly-
  // fetched status (a valid `from` state for 'collected' per
  // canTransitionOrder above). If a concurrent request changed the
  // status between our fetch + this update, the conditional WHERE
  // clause doesn't match → returns null. We throw so the shopkeeper
  // sees a clear error + re-fetches to see the current state.
  const updated = await repos.orders.transitionStatus(
    order.id,
    shop.id,
    order.status,
    { status: 'collected' },
  );
  if (!updated) {
    throw new ValidationError(
      `Order status changed concurrently (was '${order.status}' at fetch) — refresh + retry. The files were already deleted (idempotent — a retry will not double-charge).`,
    );
  }

  // STEP 3 — audit-log AFTER the successful flip (no audit entry for a
  // no-op flip). Audit is best-effort (audit-log.repository swallows
  // errors) so it can never break the collection flow.
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.complete',
    entityType: 'order',
    entityId: order.id,
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  return ok({ orderId: order.id, status: 'collected', filesDeleted: files.length });
});

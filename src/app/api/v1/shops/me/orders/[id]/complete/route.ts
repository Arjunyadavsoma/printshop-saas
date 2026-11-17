import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';
import { getContainer } from '@/lib/container';

/**
 * POST /api/v1/shops/me/orders/:id/complete — mark collected + delete files.
 *
 * H15 fix (status flip BEFORE file deletion):
 *
 * PREVIOUS BUG: `storage.deleteMany()` ran BEFORE the conditional status
 * transition. If the transition then failed (e.g. a concurrent /cancel had
 * already flipped the order to 'cancelled' between our fetch and the
 * `transitionStatus` call), the files were already gone — the shopkeeper
 * saw a "files were already deleted" warning for an order that was now
 * 'cancelled', with no way to undo. The customer's PDFs were destroyed
 * even though the order was never marked 'collected'.
 *
 * FIX: flip the order.
 *   1. Conditional status transition FIRST (`transitionStatus` with
 *      `expectedCurrentStatus=order.status`). If a concurrent request
 *      changed the status between our fetch + the update, the conditional
 *      WHERE clause doesn't match → returns null → we throw a ValidationError
 *      and the files are NOT deleted. The shopkeeper re-fetches, sees the
 *      new state, and retries only if appropriate.
 *   2. Audit-log AFTER the successful flip (no audit entry for a no-op flip).
 *   3. deleteMany LAST. If deleteMany throws (R2/S3 outage, network glitch),
 *      the order is already 'collected' — the shopkeeper's dashboard is
 *      correct and the customer sees the right state. The orphaned bytes
 *      are recovered by the scheduled FileCleanupTask / cron cleanup —
 *      they have no metadata pointer (the order is 'collected' so the file
 *      rows are no longer user-reachable) so they're a storage cost, not a
 *      privacy or correctness issue. deleteMany is idempotent so a retry
 *      from the cron is safe.
 *
 * The 60-second print-agent window is the agent's responsibility; here
 * we delete the stored blobs after the status flip and leave the metadata
 * for the audit trail.
 */
export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'collected')) {
    throw new ValidationError(`Order in status '${order.status}' cannot be marked collected`);
  }
  // STEP 1 — race-safe conditional flip FIRST. `order.status` is the
  // freshly-fetched status (a valid `from` state for 'collected' per
  // canTransitionOrder above). If a concurrent request changed the status
  // between our fetch + this update, the conditional WHERE clause doesn't
  // match → returns null → we throw BEFORE touching the files. The
  // shopkeeper sees a clear error and re-fetches; the customer's PDFs are
  // still in storage and the order is in whatever state the concurrent
  // request put it in (e.g. 'cancelled').
  const updated = await repos.orders.transitionStatus(
    order.id,
    shop.id,
    order.status,
    { status: 'collected' },
  );
  if (!updated) {
    throw new ValidationError(
      `Order status changed concurrently (was '${order.status}' at fetch) — refresh + retry. The files were NOT deleted.`,
    );
  }

  // STEP 2 — audit-log AFTER the successful flip (no audit entry for a
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

  // STEP 3 — delete the files LAST. The order is already 'collected', so a
  // deleteMany failure here leaves orphaned bytes (no metadata pointer —
  // the order is 'collected' so the file rows are no longer user-reachable)
  // which the scheduled FileCleanupTask / cron cleanup will sweep. We log
  // the failure but do NOT roll back the status — the shopkeeper's
  // dashboard is correct, the customer sees 'collected', and the bytes
  // will be reclaimed asynchronously.
  const files = await repos.files.findByOrder(order.id);
  let filesDeleted = files.length;
  try {
    const storage = getContainer().storage;
    await storage.deleteMany(files.map((f) => f.storageKey));
  } catch (err) {
    filesDeleted = 0;
    // Don't fail the request — the order is already 'collected'. Log so the
    // ops team can investigate / the cron cleanup can reclaim the bytes.
    console.error(
      `[order.complete] storage.deleteMany failed for order ${order.id} (status already flipped to 'collected'). Orphaned bytes will be reclaimed by the cleanup cron.`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return ok({ orderId: order.id, status: 'collected', filesDeleted });
}, ['owner', 'staff']);

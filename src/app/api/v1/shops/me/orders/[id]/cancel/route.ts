import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';
import { shopChannel } from '@platform/core/interfaces';
import { getContainer } from '@/lib/container';

/**
 * POST /api/v1/shops/me/orders/:id/cancel
 *
 * Cancels an order. Allowed from any non-terminal state. Audit-logs the
 * cancellation with the shopkeeper's optional reason.
 *
 * Body: { reason?: string }
 *
 * ARCH-012 fix (race-safe + agent-aware):
 *
 * PREVIOUS BUG: the route flipped the order to 'cancelled' but did NOT
 * cancel in-flight print jobs or notify the agent. The agent would
 * complete the job + call `maybeMarkOrderReady`, which (before the
 * ARCH-009 canTransitionOrder guard) flipped the order BACK to 'ready'
 * — a state-machine bypass that silently reverted the shopkeeper's
 * cancellation. Even with the guard in place, the agent still wasted
 * paper on a cancelled order.
 *
 * FIX:
 *   1. Race-safe conditional flip via `transitionStatus` with
 *      `expectedCurrentStatus=order.status`. The `canTransitionOrder`
 *      check above already verified the order is in a non-terminal
 *      state that can legally transition to 'cancelled'. If a
 *      concurrent request (e.g. another /cancel click, or /complete
 *      on a 'ready' order) changed the status between our fetch +
 *      update, the conditional WHERE clause doesn't match → returns
 *      null → we throw a ValidationError so the shopkeeper re-fetches
 *      + retries. No audit entry is written for a no-op flip.
 *   2. After the successful flip, find the order's in-flight print
 *      jobs (queued or printing) + mark them 'needs_review' with
 *      lastError='order cancelled by shopkeeper'. The PrintJob state
 *      machine (packages/core/src/domain/enums.ts) has no 'cancelled'
 *      status — 'needs_review' is the closest semantically (a job that
 *      needs shopkeeper attention before further action) AND it
 *      excludes the job from `findActiveByFile`'s active set, so the
 *      next `enqueueFilePrint` call would create a fresh job (which it
 *      won't, because the order is now cancelled — but the invariant
 *      holds). For jobs already claimed by an agent (status='printing'),
 *      the agent's next `/status` update (POST status:'completed') hits
 *      the conditional update WHERE status='printing' → returns 0 rows
 *      (the job is now 'needs_review') → the agent gets a skipped:true
 *      response + does NOT call `maybeMarkOrderReady` → the order is
 *      NOT reverted to 'ready'.
 *   3. Publish an `order.cancelled` event on the shop channel so any
 *      listening dashboard updates in real-time (best-effort —
 *      realtime is best-effort, a publish failure doesn't break the
 *      cancel flow).
 *   4. Audit-log AFTER the successful flip (so the audit trail matches
 *      the actual state transition — no audit entry for a no-op flip).
 *
 * NOTE: the agent may still be physically printing a job that was
 * already claimed when we marked it 'needs_review'. Stopping the
 * physical print would require a realtime `job.cancel` channel the
 * agent listens for — out of scope for this fix. The DB-level guard
 * (Step 2) is sufficient to prevent the order from being reverted to
 * 'ready' by `maybeMarkOrderReady`.
 */
const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const POST = withAuth<{ id: string }>(async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const body = CancelSchema.parse(await req.json());
  const shop = await repos.shops.getByOwner(principal.userId);
  const order = await repos.orders.findByIdAndShop(id, shop.id);
  if (!order) throw new NotFoundError('Order not found');
  if (!canTransitionOrder(order.status, 'cancelled')) {
    throw new ValidationError(
      `Order in status '${order.status}' cannot be cancelled`,
    );
  }

  // STEP 1 — race-safe conditional flip. `order.status` is the freshly-
  // fetched status (a valid `from` state for 'cancelled' per
  // canTransitionOrder above). If a concurrent request changed the
  // status between our fetch + this update, the conditional WHERE
  // clause doesn't match → returns null → we throw so the shopkeeper
  // sees a clear error + re-fetches to see the current state.
  const updated = await repos.orders.transitionStatus(
    order.id,
    shop.id,
    order.status,
    { status: 'cancelled' },
  );
  if (!updated) {
    throw new ValidationError(
      `Order status changed concurrently (was '${order.status}' at fetch) — refresh + retry`,
    );
  }

  // STEP 2 — cancel in-flight print jobs so the agent stops claiming /
  // reporting on them. The PrintJob state machine has no 'cancelled'
  // status; 'needs_review' is the closest + excludes the job from
  // findActiveByFile's active set. We find the order's files, then for
  // each file look up its active (queued/printing) PrintJob + flip it.
  const files = await repos.files.findByOrder(order.id);
  for (const f of files) {
    const active = await repos.printJobs.findActiveByFile(f.id);
    if (active) {
      await repos.printJobs.update(active.id, {
        status: 'needs_review',
        lastError: 'order cancelled by shopkeeper',
      });
    }
  }

  // STEP 3 — best-effort realtime event so any listening dashboard
  // updates. Realtime is best-effort — a publish failure must NOT
  // break the cancel flow (the DB flip in Step 1 is the source of
  // truth).
  try {
    await getContainer().realtime.publish(
      shopChannel(shop.id),
      'order.cancelled',
      { orderId: order.id, reason: body.reason ?? null },
    );
  } catch {
    // best-effort — swallow.
  }

  // STEP 4 — audit-log AFTER the successful flip (no audit entry for
  // a no-op flip). Audit is best-effort (audit-log.repository swallows
  // errors) so it can never break the cancel flow.
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'order.cancel',
    entityType: 'order',
    entityId: order.id,
    metadata: { reason: body.reason ?? null, previousStatus: order.status },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });
  return ok({ orderId: order.id, status: 'cancelled' });
});

import { withDeviceAuth } from '@/lib/api/with-auth';
import { ok } from '@/lib/api/envelope';
import {
  pullSince,
  getOrCreateSyncState,
  updateSyncCursor,
} from '@/lib/repositories/sync.repository';

/**
 * GET /api/v1/sync/pull?cursor=&limit= — device-token-authed.
 *
 * Incremental pull of changes since the cursor for the device's shop.
 * The cursor is an ISO timestamp; the initial cursor is the epoch
 * (`1970-01-01T00:00:00Z`) which pulls everything on first sync.
 *
 * The shopId comes from the authenticated device token (AgentPrincipal) —
 * NEVER from the query string. This is the tenant boundary.
 *
 * After a successful pull, the device's persisted sync cursor advances to
 * the latest `updatedAt` in the returned batch. The client should call this
 * again immediately if `hasMore` is true (a per-entity limit was hit).
 */
export const GET = withDeviceAuth(async (req, _ctx, agentPrincipal) => {
  const url = new URL(req.url);
  const clientCursor =
    url.searchParams.get('cursor') || '1970-01-01T00:00:00Z';

  // Cap the limit at 500 to bound a single response. Default 100.
  const limitParam = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;

  // Resolve the device's persisted cursor — used as a fallback when the
  // client doesn't pass one (or passes an empty string). The client should
  // always pass its last `nextCursor`, but this guards against lost state.
  const state = await getOrCreateSyncState(
    agentPrincipal.shopId,
    agentPrincipal.agent.id,
  );
  const effectiveCursor = clientCursor || state.syncCursor;

  const result = await pullSince(agentPrincipal.shopId, effectiveCursor, limit);

  // Advance the device's persisted cursor only if we actually returned
  // changes — otherwise we'd write the same cursor back (a no-op write
  // that bumps `updatedAt` on the state row for no reason).
  if (result.changes.length > 0) {
    await updateSyncCursor(state.id, result.nextCursor);
  }

  return ok(result);
});

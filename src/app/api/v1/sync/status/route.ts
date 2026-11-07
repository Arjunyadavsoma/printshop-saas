import { withDeviceAuth } from '@/lib/api/with-auth';
import { ok } from '@/lib/api/envelope';
import { getOrCreateSyncState } from '@/lib/repositories/sync.repository';

/**
 * GET /api/v1/sync/status — device-token-authed.
 *
 * Returns the device's current sync state. The desktop polls this on
 * startup (to display "last synced: X minutes ago" in the UI) and after
 * reconnect (to decide whether a full re-sync is needed — see
 * SYNC_PROTOCOL.md §6: "Long offline (>24h) → full re-sync").
 *
 * The shopId comes from the device token — never from the query string.
 */
export const GET = withDeviceAuth(async (_req, _ctx, agentPrincipal) => {
  const state = await getOrCreateSyncState(
    agentPrincipal.shopId,
    agentPrincipal.agent.id,
  );
  return ok({
    deviceId: agentPrincipal.agent.id,
    shopId: agentPrincipal.shopId,
    syncCursor: state.syncCursor,
    lastSyncAt: state.lastSyncAt,
    lastPushAt: state.lastPushAt,
    agentName: agentPrincipal.agent.name,
    isOnline: agentPrincipal.agent.isOnline,
    // Note: pendingPulls/pendingPushes are not computed in v1 — they
    // require a separate delta count query which is deferred to Phase 5.1.
    // The desktop can infer "pending pulls" by comparing its local cursor
    // against this server cursor (if they differ, there's work to do).
  });
});

/**
 * Realtime event publishing for queue v2.
 *
 * After every queue action (reorder, priority change, hold/release, claim,
 * release, reroute, reprint, status transition, printer status, agent
 * status, device revoked), publish a socket event on the shop's realtime
 * channel along with a monotonically increasing `queueVersion`.
 *
 * `queueVersion` is per-shop, stored in the cache, incremented atomically
 * via `cache.incr`. Subscribers use it to detect missed events: when a
 * client reconnects and the latest `queueVersion` it saw is more than 1
 * behind the server's current value, it must re-fetch the full queue
 * snapshot instead of trusting incremental updates.
 *
 * All events share the same envelope:
 *   { shopId, queueVersion, eventName, payload, ts }
 *
 * The container's realtime adapter is used so this stays backend-only —
 * the `z-ai-web-dev-sdk` is never imported on the client side.
 */

import { getContainer } from '@/lib/container';
import { shopChannel } from '@platform/core/interfaces';

/** Cache key for a shop's queue version counter. */
function versionKey(shopId: string): string {
  return `queue:v2:${shopId}:version`;
}

/**
 * Atomically increment and return the per-shop queue version.
 *
 * Uses `cache.incr` so concurrent actions across requests still produce
 * strictly increasing integers (the cache adapter's `incr` is atomic for
 * both the in-memory and Upstash implementations).
 *
 * Falls back to `0` (and logs) if the cache is unreachable — the queue
 * action itself must NEVER fail because the realtime version could not be
 * minted. A missed increment is observable by clients as a gap; their
 * re-fetch-on-reconnect logic handles it.
 */
export async function nextQueueVersion(shopId: string): Promise<number> {
  const cache = getContainer().cache;
  try {
    const v = await cache.incr(versionKey(shopId));
    // Some cache implementations start counters at 0; normalise to 1-based.
    return Math.max(1, typeof v === 'number' ? v : 1);
  } catch {
    getContainer().logger.warn('queue-events: cache.incr failed — version not advanced', { shopId });
    return 0;
  }
}

/**
 * Read the current queue version WITHOUT incrementing. Used by the
 * `GET /shop/queue` snapshot endpoint so clients can seed their
 * `lastSeenVersion` baseline on first load.
 */
export async function currentQueueVersion(shopId: string): Promise<number> {
  const cache = getContainer().cache;
  try {
    const raw = await cache.get(versionKey(shopId));
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * The namespaced event names emitted on the shop channel. Exported so
 * client subscribers and tests can reference them without typos.
 */
export const QUEUE_EVENTS = {
  queueUpdated: 'queue.updated',
  taskClaimed: 'task.claimed',
  taskReleased: 'task.released',
  taskPriorityChanged: 'task.priority.changed',
  taskHeld: 'task.held',
  taskStatus: 'task.status',
  printerStatus: 'printer.status',
  agentStatus: 'agent.status',
  deviceRevoked: 'device.revoked',
} as const;

export type QueueEventName = (typeof QUEUE_EVENTS)[keyof typeof QUEUE_EVENTS];

/** Standard envelope for every queue event. */
export interface QueueEventEnvelope {
  shopId: string;
  queueVersion: number;
  event: QueueEventName;
  payload: Record<string, unknown>;
  ts: string;
}

/**
 * Publish a queue event on the shop's realtime channel.
 *
 * Best-effort: a publish failure is logged but NEVER thrown — queue
 * mutations must succeed even if the realtime relay is down. The
 * `queueVersion` is still incremented BEFORE the publish attempt so
 * reconnecting clients re-fetching the snapshot see the latest state.
 *
 * @returns the queueVersion that was attached to the event (0 if the
 *          cache increment failed).
 */
export async function publishQueueEvent(
  shopId: string,
  event: QueueEventName,
  payload: Record<string, unknown>,
): Promise<number> {
  const queueVersion = await nextQueueVersion(shopId);
  const envelope: QueueEventEnvelope = {
    shopId,
    queueVersion,
    event,
    payload,
    ts: new Date().toISOString(),
  };
  try {
    await getContainer().realtime.publish(shopChannel(shopId), event, envelope);
  } catch (cause) {
    getContainer().logger.warn('queue-events: realtime publish failed', {
      shopId,
      event,
      queueVersion,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return queueVersion;
}

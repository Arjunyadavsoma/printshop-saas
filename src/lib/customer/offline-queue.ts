/**
 * Offline action queue for safe, idempotent customer actions (P8.8).
 *
 * The customer flow has a small set of mutations that are SAFE to defer
 * until the device reconnects:
 *   - submit a UTR (the shopkeeper verifies later; a duplicate UTR submit
 *     is a no-op because the same order idempotency key produces the same
 *     server-side state)
 *   - cancel an order (already-cancelled → no-op)
 *   - mark a note on an order (note is keyed by order + timestamp; a
 *     duplicate just rewrites the same note)
 *
 * It is NOT safe to queue:
 *   - order creation (a duplicate creates a second order, with a second
 *     payment obligation — financial risk)
 *   - payment initiation (a duplicate creates a second PaymentAttempt,
 *     which can confuse reconciliation)
 *
 * Those actions are NEVER enqueued here. The caller is responsible for
 * surfacing an inline error ("You're offline — payment can't start until
 * you reconnect") and refusing to enqueue.
 *
 * ── Persistence ──────────────────────────────────────────────────────────
 * The queue lives in `localStorage` (key: `printshop:offline-queue`). We use
 * localStorage (not IndexedDB) because:
 *   - The queue is small (a handful of safe actions per device).
 *   - Writes are rare (one per user action) and need to be synchronous so a
 *     tab close right after the enqueue doesn't drop the action.
 *   - We need cross-tab visibility (the `storage` event lets another tab's
 *     useOfflineQueue hook see the new entry without a manual refetch).
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 * Every queued action carries an `id` field that doubles as the
 * idempotency key. When the queue replays, each request is sent with
 *   `X-Idempotency-Key: <id>`
 * The server-side dedup logic (in the route handler) checks for an existing
 * completed response for that key; if found, it returns the cached response
 * instead of re-executing the mutation. This means a double-replay (e.g. two
 * tabs both replaying on reconnect) is safe: only the first replay executes,
 * the second sees the cached response.
 *
 * The `id` is also the localStorage key — re-enqueuing the SAME action (same
 * `id`) does NOT add a duplicate; it updates the timestamp of the existing
 * entry so the most recent attempt wins.
 *
 * ── Replay trigger ───────────────────────────────────────────────────────
 * Two replay paths:
 *   1. Background Sync API (`navigator.serviceWorker.syncManager`): if the
 *      browser supports it AND a service worker is registered, we register
 *      a sync tag (`printshop-offline-queue`). The browser fires the
 *      `sync` event in the SW when the device is online; the SW
 *      `postMessage`s the page, which calls `replayQueue()`. This works
 *      even if the tab is closed.
 *   2. `online` event: if Background Sync is unavailable, we fall back to
 *      listening for `window.addEventListener('online', …)` and replay on
 *      the next online event.
 *
 * ── SSR safety ───────────────────────────────────────────────────────────
 * Every function guards on `typeof window === 'undefined'` so this module
 * can be imported by a Server Component without crashing. SSR callers see
 * an empty queue.
 */

/** A queued HTTP action awaiting replay on reconnect. */
export interface QueuedAction {
  /**
   * Idempotency key — also the localStorage dedup key. Must be stable for
   * the same logical action (e.g. `submit-utr:${orderId}` so re-enqueuing a
   * UTR submit for the same order doesn't duplicate). The caller chooses
   * the format; we just enforce uniqueness within the queue.
   */
  id: string;
  /** HTTP method. Only safe, idempotent mutations are queued. */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relative URL (e.g. `/api/v1/o/ABC123/utr`). Never absolute — the
   *  gateway handles port routing via `XTransformPort`. */
  url: string;
  /** JSON-serializable request body (object). Sent as the fetch body. */
  body: unknown;
  /** Epoch ms — when the action was enqueued. Used for replay ordering. */
  timestamp: number;
}

const STORAGE_KEY = 'printshop:offline-queue';
export { STORAGE_KEY };
/** Sync tag registered with the Background Sync API. */
export const SYNC_TAG = 'printshop-offline-queue';
/** HTTP header name for the idempotency key. */
export const IDEMPOTENCY_HEADER = 'X-Idempotency-Key';

/** The allow-list of URL prefixes that may be queued. Anything else is
 *  rejected at enqueue time — this is the safety net that prevents a
 *  future caller from accidentally queueing order creation or payment
 *  initiation. */
const ALLOWED_URL_PREFIXES: readonly RegExp[] = [
  // Submit UTR — idempotent (server dedups by order + UTR).
  /^\/api\/v1\/o\/[^/]+\/utr(?:[/?#]|$)/,
  // Cancel order — idempotent (already-cancelled → no-op).
  /^\/api\/v1\/o\/[^/]+\/cancel(?:[/?#]|$)/,
  // Order note — idempotent (note keyed by order; rewrite is safe).
  /^\/api\/v1\/o\/[^/]+\/note(?:[/?#]|$)/,
] as const;

/** Returns true if `url` matches one of the allowed safe-action prefixes. */
export function isQueueableUrl(url: string): boolean {
  // Strip the query string before matching (XTransformPort is a query param
  // we don't want to match against).
  const path = url.split(/[?#]/)[0];
  return ALLOWED_URL_PREFIXES.some((re) => re.test(path));
}

/** Internal: read the queue from localStorage. SSR → []. */
function readQueue(): QueuedAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: filter out malformed entries (a corrupt entry should not
    // brick the whole queue).
    return parsed.filter(isValidAction);
  } catch {
    // Corrupt JSON or storage disabled — start empty.
    return [];
  }
}

/** Internal: write the queue to localStorage. SSR → no-op. */
function writeQueue(queue: QueuedAction[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    // Notify other tabs (the `storage` event does not fire in the same tab
    // that wrote; use a custom event for in-tab subscribers).
    window.dispatchEvent(new CustomEvent('printshop:offline-queue-changed'));
  } catch {
    // Quota exceeded / storage disabled — swallow. The action is lost;
    // the caller should have surfaced an inline error before calling
    // enqueue (the queue is best-effort, not a guarantee).
  }
}

/** Type guard: a valid QueuedAction has the right shape + types. */
function isValidAction(value: unknown): value is QueuedAction {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === 'string' &&
    typeof a.method === 'string' &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(a.method as string) &&
    typeof a.url === 'string' &&
    typeof a.timestamp === 'number'
    // `body` can be anything JSON-serializable (incl. null / undefined).
  );
}

/**
 * Enqueue a safe, idempotent action for replay on reconnect.
 *
 * The `id` and `timestamp` are added by this function — the caller passes
 * only `method`, `url`, `body`, and (critically) a stable `id`.
 *
 * WAIT — re-reading the brief: the caller passes the action WITHOUT `id`
 * and `timestamp`, and we generate them. But the caller MUST choose the
 * idempotency key (it needs to be stable across re-enqueues of the same
 * logical action). So we accept an optional `id` from the caller; if not
 * provided, we derive one from `method + url + body` (a content-addressed
 * key). The caller-provided id wins because it's more stable (the body may
 * differ slightly between re-attempts).
 *
 * @throws {Error} if `url` is not in the allow-list (safe-action check).
 */
export function enqueue(action: Omit<QueuedAction, 'id' | 'timestamp'> & { id?: string }): void {
  if (typeof window === 'undefined') return;
  if (!isQueueableUrl(action.url)) {
    throw new Error(
      `Refusing to enqueue non-safe action: ${action.method} ${action.url}. ` +
        'Only UTR submit, cancel order, and order note may be queued.',
    );
  }
  const id = action.id ?? deriveId(action);
  const timestamp = Date.now();
  const queue = readQueue();
  // Dedup by id: if an entry with the same id exists, REPLACE it (the new
  // body + timestamp win). This is the idempotency guarantee — re-enqueuing
  // the same action does not duplicate.
  const filtered = queue.filter((a) => a.id !== id);
  filtered.push({ id, method: action.method, url: action.url, body: action.body, timestamp });
  writeQueue(filtered);
  // Best-effort: register a Background Sync tag so the SW fires `sync` on
  // reconnect (even if this tab is closed). If unavailable, the `online`
  // event listener in the hook handles replay.
  void registerBackgroundSync();
}

/**
 * Derive a content-addressed idempotency key from the action. Used when the
 * caller doesn't pass an explicit `id`. The key is `method:url:bodyHash`
 * where bodyHash is a short FNV-1a hash of the JSON-stringified body.
 *
 * This is stable for the same inputs, so re-enqueuing the same action
 * (same method + url + body) deduplicates. The caller-provided id is
 * preferred when the body may differ between attempts (e.g. a timestamp
 * inside the body).
 */
export function deriveId(action: Omit<QueuedAction, 'id' | 'timestamp'>): string {
  const bodyJson = JSON.stringify(action.body ?? '');
  // FNV-1a 32-bit hash — fast, no deps, good enough for dedup.
  let hash = 0x811c9dc5;
  for (let i = 0; i < bodyJson.length; i++) {
    hash ^= bodyJson.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned 32-bit.
  const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${action.method}:${action.url}:${hashHex}`;
}

/** Returns a snapshot of the current queue (oldest first). SSR → []. */
export function getQueue(): QueuedAction[] {
  return readQueue().sort((a, b) => a.timestamp - b.timestamp);
}

/** Returns the count of queued actions (for a UI badge). SSR → 0. */
export function getQueueLength(): number {
  return readQueue().length;
}

/**
 * Replay every queued action in order (oldest first). Each request is sent
 * with the `X-Idempotency-Key` header so the server dedup is enforced.
 *
 * On success (2xx response): the action is removed from the queue.
 * On failure (network error or non-2xx): the action STAYS in the queue
 *   for the next replay attempt. We do NOT retry immediately — the next
 *   `online` event or Background Sync fires another replay.
 *
 * Multiple concurrent replay calls are coalesced via a module-level
 * `replayInFlight` promise — only one replay pass runs at a time.
 *
 * Returns a promise that resolves when the replay pass completes (NOT when
 * every action succeeds — failed actions stay queued). The caller can
 * inspect `getQueue()` after the await to see what's still pending.
 */
let replayInFlight: Promise<void> | null = null;

export async function replayQueue(): Promise<void> {
  if (typeof window === 'undefined') return;
  // Coalesce concurrent calls — the hook may fire on both `online` AND a
  // Background Sync `sync` event in quick succession.
  if (replayInFlight) return replayInFlight;
  replayInFlight = doReplay().finally(() => {
    replayInFlight = null;
  });
  return replayInFlight;
}

/** Internal: the actual replay pass. */
async function doReplay(): Promise<void> {
  // Don't replay if we're still offline — `navigator.onLine` is the source
  // of truth (the `online` event can fire slightly before the network is
  // actually usable).
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const queue = getQueue();
  if (queue.length === 0) return;

  // Replay in order. We DO NOT parallelize — the actions may have
  // ordering dependencies (e.g. submit UTR before cancel). Sequential also
  // keeps the server load predictable.
  const remaining: QueuedAction[] = [];
  for (const action of queue) {
    const ok = await sendOnce(action);
    if (ok) {
      // Successfully replayed — drop from queue.
      continue;
    }
    // Failed — keep for the next replay.
    remaining.push(action);
  }
  writeQueue(remaining);
}

/**
 * Send a single queued action. Returns true on success (2xx), false on
 * any failure (network error or non-2xx response).
 */
async function sendOnce(action: QueuedAction): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      [IDEMPOTENCY_HEADER]: action.id,
      'Content-Type': 'application/json',
    };
    const init: RequestInit = {
      method: action.method,
      headers,
    };
    if (action.method !== 'DELETE' && action.body !== undefined && action.body !== null) {
      init.body = JSON.stringify(action.body);
    }
    const res = await fetch(action.url, init);
    // 2xx → success. 409 Conflict is also success — it means the server
    // already processed this idempotency key (a previous replay won).
    if (res.ok || res.status === 409) return true;
    // 4xx (except 409, 408, 429) → the request itself is bad; retrying
    // won't help. Drop it to avoid an infinite loop.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      return true; // treat as "handled" so it's dropped from the queue
    }
    // 5xx / 408 / 429 → transient; keep for next replay.
    return false;
  } catch {
    // Network error (fetch threw) — keep for next replay.
    return false;
  }
}

/** Wipe the entire queue. Use after a successful logout or a "clear my
 *  data" action. Does NOT cancel any in-flight replays. SSR → no-op. */
export function clearQueue(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('printshop:offline-queue-changed'));
  } catch {
    // ignore
  }
}

/**
 * Register a Background Sync tag for the offline queue. The SW's `sync`
 * event listener (in `public/sw.js`) calls `replayQueue()` via a
 * `postMessage` to the page.
 *
 * No-op if Background Sync is unavailable (older browsers, iOS Safari).
 * The `online` event listener in `useOfflineQueue` is the fallback path.
 *
 * Resolves `true` if the sync tag was registered, `false` otherwise.
 */
export async function registerBackgroundSync(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('SyncManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.sync) return false;
    await reg.sync.register(SYNC_TAG);
    return true;
  } catch {
    // Sync registration can fail in private browsing mode or if the SW is
    // not yet active. The `online` event fallback covers us.
    return false;
  }
}

/**
 * Subscribe to queue changes. The callback is fired on every enqueue,
 * clear, and replay write. Returns an unsubscribe function.
 *
 * Used by the `useOfflineQueue` hook to keep React state in sync without
 * polling. SSR: the subscription is a no-op (no `window`).
 */
export function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) callback();
  };
  window.addEventListener('printshop:offline-queue-changed', onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('printshop:offline-queue-changed', onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

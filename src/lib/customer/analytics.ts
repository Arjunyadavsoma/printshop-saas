/**
 * analytics — privacy-friendly client-side event tracking.
 *
 * NO third-party trackers (no GA, no Mixpanel, no Meta pixel). Events are
 * queued in localStorage and flushed in batches to our own
 * `/api/v1/analytics/track` endpoint every 30 seconds OR when 20 events
 * accumulate (whichever comes first).
 *
 * Privacy contract (enforced by the caller — NOT by this module):
 *   - NO phone numbers
 *   - NO file names
 *   - NO UTR values
 *   - NO order tokens
 *   - Only event names + anonymous properties:
 *       shop_slug, page_count, preset_name, amount_paise_range, app_id, …
 *
 * The `track()` function is fire-and-forget — it never throws and never
 * blocks the caller. All failures (network down, IndexedDB unavailable,
 * JSON serialization errors) are silently swallowed: analytics must NEVER
 * break the order flow.
 *
 * SSR-safe: `track()` is a no-op when `typeof window === 'undefined'`, so
 * it can be imported into Server Components or shared utilities without
 * guarding at every call site.
 */

const EVENTS_KEY = 'printshop:analytics-events';
const MAX_EVENTS = 100;
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_THRESHOLD = 20;
const FLUSH_ENDPOINT = '/api/v1/analytics/track';

export interface AnalyticsEvent {
  /** The event name, e.g. 'shop_landed' / 'upload_started' / 'paid_clicked'. */
  event: string;
  /** Anonymous properties only — never phone numbers, file names, or UTR. */
  properties: Record<string, string | number | boolean>;
  /** Client-side epoch ms — for ordering / dedup on the server. */
  client_ts: number;
}

// Module-level state — singleton across the page lifetime. Lives only on
// the client (the SSR guard in `track` ensures this is never touched on
// the server).
let events: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

/**
 * Lazy init: load any unflushed events from localStorage (so a reload
 * before the next 30s flush doesn't lose them) + arm the periodic flush
 * timer + best-effort flush on pagehide / visibilitychange→hidden.
 *
 * Idempotent: the first call sets `initialized = true` and subsequent calls
 * are no-ops.
 */
function ensureInit(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Re-hydrate the queue from localStorage.
  try {
    const raw = window.localStorage.getItem(EVENTS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        events = parsed
          .filter((e): e is AnalyticsEvent =>
            e != null &&
            typeof e === 'object' &&
            typeof (e as AnalyticsEvent).event === 'string')
          .slice(-MAX_EVENTS);
      }
    }
  } catch {
    // corrupt JSON — start with an empty queue
  }

  // Periodic flush every 30s.
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  // Best-effort flush when the page is hidden / unloaded. `keepalive: true`
  // on the fetch lets the request outlive the page in modern browsers.
  const onHide = () => {
    void flush();
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

/** Persist the queue to localStorage so a reload doesn't lose unflushed events. */
function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    // FIFO: keep only the most recent MAX_EVENTS entries.
    if (events.length > MAX_EVENTS) {
      events = events.slice(-MAX_EVENTS);
    }
    window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // quota exceeded / privacy mode — silently drop; analytics is best-effort.
  }
}

/**
 * Flush the queue to the server. Sends everything currently in the queue
 * in a single POST. On failure (network down / non-2xx), the batch is
 * re-queued at the front so events are not lost — they'll retry on the
 * next flush.
 *
 * Never throws. Never rejects.
 */
async function flush(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (events.length === 0) return;
  const batch = events.splice(0, events.length);
  try {
    const res = await fetch(FLUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
      credentials: 'omit',
    });
    if (!res.ok) {
      // Server rejected — re-queue (capped at MAX_EVENTS).
      events = [...batch, ...events].slice(-MAX_EVENTS);
      persist();
    } else {
      // Successfully flushed — clear the persisted queue.
      persist();
    }
  } catch {
    // Network failure — re-queue + persist.
    events = [...batch, ...events].slice(-MAX_EVENTS);
    persist();
  }
}

/**
 * Track a customer analytics event. Fire-and-forget: never throws, never
 * blocks the caller, never breaks the order flow on failure.
 *
 * @param event     The event name (snake_case, e.g. 'shop_landed').
 * @param properties Anonymous properties only. NEVER pass phone numbers,
 *                   file names, UTR values, or order tokens. Use ranges
 *                   for amounts (e.g. `amount_paise_range: '100-500'`).
 */
export function track(
  event: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  if (typeof window === 'undefined') return;
  ensureInit();
  events.push({ event, properties, client_ts: Date.now() });
  persist();
  // Immediate flush when the threshold is hit — don't wait up to 30s.
  if (events.length >= FLUSH_THRESHOLD) {
    void flush();
  }
}

/**
 * Force-flush the queue now. Useful for tests or for an explicit "send
 * now" action (e.g. just before navigating away).
 */
export async function flushAnalytics(): Promise<void> {
  if (typeof window === 'undefined') return;
  await flush();
}

// ── Convenience: named event constants ─────────────────────────────────────
// These exist so call sites use a typed constant instead of a string
// literal — a typo like 'shop_landned' would silently never be tracked.
// The strings themselves are the canonical event names the server expects.

export const ANALYTICS_EVENTS = {
  shopLanded: 'shop_landed',
  uploadStarted: 'upload_started',
  uploadFailed: 'upload_failed',
  fileReady: 'file_ready',
  presetChosen: 'preset_chosen',
  moreOptionsOpened: 'more_options_opened',
  pagePickerOpened: 'page_picker_opened',
  colourPagesChanged: 'colour_pages_changed',
  quoteViewed: 'quote_viewed',
  checkoutStarted: 'checkout_started',
  paymentAppTapped: 'payment_app_tapped',
  paidClicked: 'paid_clicked',
  utrSubmitted: 'utr_submitted',
  paymentConfirmed: 'payment_confirmed',
  paymentRejected: 'payment_rejected',
  orderReadySeen: 'order_ready_seen',
  reorderClicked: 'reorder_clicked',
} as const;

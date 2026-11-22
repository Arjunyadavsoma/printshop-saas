'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useTrackPoll — visibility-aware polling with exponential backoff for the
 * order tracking page (`/o/[token]`). Implements the P0 fixes from the
 * Phase 0 audit:
 *
 *  1. **Pause when `document.hidden`** — never fire a request while the tab
 *     is in the background (battery + server-quota friendly). The moment the
 *     tab becomes visible again, a tick fires immediately so stale UI never
 *     lingers.
 *  2. **Exponential backoff after 5 min of no status change** — 5s → 10s →
 *     30s → 60s. The cadence steps down every 5 min that the order's status
 *     stays the same. The first observed status change resets the cadence
 *     to 5s.
 *  3. **Stop entirely after 30 min of no status change** — abandoned tabs
 *     eventually give up. The host can restart polling by re-mounting
 *     (e.g. by tapping a "Refresh" button).
 *  4. **Offline-aware** — when `navigator.onLine === false`, polling pauses
 *     entirely. Returning online triggers an immediate tick.
 *
 * The hook is generic over the fetched payload type `T` so callers can pass
 * a typed `fetcher` (returning `{ data, status }` or throwing). It surfaces
 * three explicit states: `idle` | `loading` (first load) | `ready` |
 * `error`, plus the latest payload when ready. A `notFound` flag is set when
 * the fetcher reports a 404 so the host can render the dedicated "Order not
 * found" panel instead of the generic error.
 */

/** Backoff cadence after the 5-min fresh window expires. */
const BACKOFF_SCHEDULE_MS = [10_000, 30_000, 60_000] as const;
const FRESH_INTERVAL_MS = 5_000;
const STALE_AFTER_MS = 5 * 60 * 1000; // 5 min: step down one backoff level
const STOP_AFTER_MS = 30 * 60 * 1000; // 30 min: stop polling entirely

/** The lifecycle the host should render. */
export type TrackPhase = 'idle' | 'loading' | 'ready' | 'error';

/** What the fetcher returns. `ok: false` with `status: 404` is treated as "not found". */
export interface FetchResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  message?: string;
}

export interface UseTrackPollResult<T> {
  phase: TrackPhase;
  /** The latest payload, or null before the first successful load. */
  data: T | null;
  /** The error message surfaced to the user, or null when none. */
  error: string | null;
  /** True when the fetcher reported a 404 (vs a network/server error). */
  notFound: boolean;
  /** Manually re-run the fetcher + reset the backoff cadence. */
  refresh: () => void;
}

/**
 * @param fetcher Async function that performs the network call. It should
 *   NOT throw on HTTP errors — instead return `{ ok: false, status, message }`.
 *   Throwing is fine too (treated as a generic network error).
 * @param deps When any dep changes, polling restarts at the fresh 5s cadence
 *   and the first load fires immediately.
 */
export function useTrackPoll<T>(
  fetcher: () => Promise<FetchResult<T>>,
  deps: readonly unknown[] = [],
): UseTrackPollResult<T> {
  const [phase, setPhase] = useState<TrackPhase>('idle');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Refs hold the latest mutable polling state — they don't trigger renders.
  const fetcherRef = useRef(fetcher);
  const lastStatusRef = useRef<string | null>(null); // last seen order.status
  const lastChangeAtRef = useRef<number>(Date.now()); // when status last changed
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Compute the next interval based on how long the status has been stable.
  const computeInterval = useCallback((): number => {
    const elapsed = Date.now() - lastChangeAtRef.current;
    if (elapsed < STALE_AFTER_MS) return FRESH_INTERVAL_MS;
    if (elapsed >= STOP_AFTER_MS) return -1; // sentinel: stop
    // Step down through the backoff schedule based on elapsed time.
    const stepsIntoBackoff = Math.floor((elapsed - STALE_AFTER_MS) / STALE_AFTER_MS);
    const idx = Math.min(stepsIntoBackoff, BACKOFF_SCHEDULE_MS.length - 1);
    return BACKOFF_SCHEDULE_MS[idx];
  }, []);

  const runTick = useCallback(async () => {
    // Don't fire if offline — the visibility/online listeners will catch the
    // transition back to online and immediately call runTick.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Don't fire while the tab is hidden — visibilitychange will fire it on return.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (stoppedRef.current) return;

    let result: FetchResult<T>;
    try {
      result = await fetcherRef.current();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Network error';
      // Only flip to error on the FIRST load (no prior data); subsequent
      // failures keep the last-good data on screen so the customer isn't
      // booted out of the page mid-flow.
      if (data === null) {
        setPhase('error');
        setError(message);
      }
      return;
    }

    if (!result.ok) {
      if (result.status === 404) {
        setNotFound(true);
        setPhase('error');
        setError(result.message ?? 'Order not found');
        stoppedRef.current = true; // no point polling a non-existent order
        return;
      }
      if (data === null) {
        setPhase('error');
        setError(result.message ?? 'Could not load this order');
      }
      return;
    }

    const next = result.data;
    if (next) {
      // Detect status change for backoff purposes. The host should expose the
      // status as a stable string key on the payload — we read it generically.
      const nextStatus = readStatus(next);
      const prev = lastStatusRef.current;
      if (prev !== null && nextStatus !== prev) {
        lastChangeAtRef.current = Date.now();
      }
      lastStatusRef.current = nextStatus;
      setData(next);
      setError(null);
      setPhase('ready');

      // Terminal states stop polling.
      if (isTerminal(nextStatus)) {
        stoppedRef.current = true;
      }
    }
  }, [data]);

  // `scheduleNext` needs to reference itself (the timer callback reschedules
  // the next tick). Use a ref so the inner closure calls the latest version
  // without creating a forward-reference lint error.
  const scheduleNextRef = useRef<() => void>(() => {});

  const scheduleNext = useCallback(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    const ms = computeInterval();
    if (ms < 0) {
      // 30 min of no change — stop entirely.
      stoppedRef.current = true;
      return;
    }
    intervalRef.current = setTimeout(async () => {
      await runTick();
      // Re-read the latest scheduleNext via the ref so we always use the
      // current closure (runTick's deps include `data`, so the callback
      // identity changes when data updates).
      scheduleNextRef.current();
    }, ms);
  }, [computeInterval, runTick]);

  // Keep the ref in sync with the latest closure.
  useEffect(() => {
    scheduleNextRef.current = scheduleNext;
  }, [scheduleNext]);

  // The main polling effect — re-arms whenever deps change.
  useEffect(() => {
    stoppedRef.current = false;
    lastStatusRef.current = null;
    lastChangeAtRef.current = Date.now();
    setPhase('loading');
    setError(null);
    setNotFound(false);

    void runTick();
    scheduleNext();

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !stoppedRef.current) {
        // Tab came back — refresh immediately + resume the schedule.
        void runTick().then(() => {
          if (!stoppedRef.current) scheduleNext();
        });
      }
    };
    const onOnline = () => {
      if (!stoppedRef.current) {
        void runTick().then(() => {
          if (!stoppedRef.current) scheduleNext();
        });
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', () => {
      // Nothing to do — runTick already short-circuits on offline.
    });

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [...deps]);

  const refresh = useCallback(() => {
    // Reset the cadence + immediately fire.
    stoppedRef.current = false;
    lastChangeAtRef.current = Date.now();
    setPhase('loading');
    setError(null);
    setNotFound(false);
    void runTick().then(() => scheduleNext());
  }, [runTick, scheduleNext]);

  return { phase, data, error, notFound, refresh };
}

/**
 * Best-effort read of `payload.order.status` (the shape returned by
 * `/api/v1/o/[token]`). If the field is absent, returns null so the backoff
 * logic doesn't treat every load as a status change.
 */
function readStatus<T>(payload: T): string | null {
  if (payload && typeof payload === 'object') {
    const order = (payload as { order?: unknown }).order;
    if (order && typeof order === 'object') {
      const status = (order as { status?: unknown }).status;
      if (typeof status === 'string') return status;
    }
  }
  return null;
}

/** Terminal states — no further polling once reached. */
const TERMINAL_STATUSES = new Set(['collected', 'cancelled', 'expired', 'failed']);
function isTerminal(status: string | null): boolean {
  return status !== null && TERMINAL_STATUSES.has(status);
}

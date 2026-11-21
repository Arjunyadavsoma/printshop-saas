/**
 * usePoll — visibility-aware polling (P2-5 fix).
 *
 * Runs `fn` every `intervalMs` while the tab is VISIBLE. When the tab is
 * hidden the interval fires but skips the call (battery / data saving on
 * mobile), and the moment the tab becomes visible again `fn` runs
 * immediately so stale UI never lingers.
 *
 * Replaces six hand-rolled `setInterval` loops that polled even when the
 * tab was hidden (dashboard 15s, orders 20s, order detail 5s, payments 20s,
 * shop customers 30s, customer tracking 30s).
 *
 * Options:
 *   - `deps` re-arms the effect (same semantics as useEffect deps).
 *   - `enabled=false` pauses entirely (e.g. terminal order states).
 *   - `immediate=false` skips the initial call — for pages whose first load
 *     must be NON-silent (drives the loading spinner) while interval ticks
 *     are silent refreshes.
 */
import { useEffect, useRef } from 'react';

export interface UsePollOptions {
  deps?: readonly unknown[];
  enabled?: boolean;
  immediate?: boolean;
}

export function usePoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  options: UsePollOptions = {},
): void {
  const { deps = [], enabled = true, immediate = true } = options;

  // Keep the latest callback without making it a dependency (avoids the
  // classic "interval resets every render" bug when callers pass inline
  // arrows; the closure always sees fresh state via the ref).
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    if (typeof document === 'undefined') return; // SSR safety

    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (document.visibilityState === 'visible') {
        void fnRef.current();
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        // Tab came back — refresh immediately instead of waiting a full
        // interval, then keep the regular cadence.
        void fnRef.current();
      }
    };

    if (immediate) void fnRef.current();
    timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled, immediate, ...deps]);
}

'use client';

/**
 * useOrderRealtime — React wrapper around {@link OrderRealtimeClient}.
 *
 * Mount behaviour:
 *  1. Creates an `OrderRealtimeClient` for the order token.
 *  2. Subscribes to status changes → updates the `status` state.
 *  3. Tracks `isConnected` + `usingPollingFallback` from the client.
 *  4. When the socket trips the fallback (down OR 3 failed reconnects),
 *     internally starts `useTrackPoll` polling `/api/v1/o/[token]` to keep
 *     `status` fresh.
 *  5. When the socket reconnects, the client calls `onReconnectSync`, which:
 *       - stops the polling fallback,
 *       - fetches the current state to catch missed events.
 *  6. Cleans up the socket + all timers on unmount.
 *
 * The host (the /o/[token] page) uses this hook for instant status updates
 * (the StatusPill) and for the connection-health flags. The host's own
 * `useTrackPoll` continues to provide the full data payload (price, files,
 * tasks); when this hook fires a status change, the host can `refresh()` its
 * data polling hook to fetch the updated payload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  OrderRealtimeClient,
  type StatusChangeCallback,
} from '@/lib/customer/realtime-client';
import { useTrackPoll, type FetchResult } from '@/lib/hooks/use-track-poll';

export interface UseOrderRealtimeResult {
  /** The latest order status (from socket OR polling fallback). Null until first event. */
  status: string | null;
  /** True when the socket is open + authed. */
  isConnected: boolean;
  /** True when polling is being used as the fallback (socket is down). */
  usingPollingFallback: boolean;
}

/** The shape we extract from /api/v1/o/[token] for the polling fallback. */
type TrackPayload = { order?: { status?: string } };

export function useOrderRealtime(orderToken: string | null): UseOrderRealtimeResult {
  const [status, setStatus] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [usingPollingFallback, setUsingPollingFallback] = useState(false);

  // The client lives in a ref so it survives re-renders. The polling
  // fallback's `enabled` flag is driven by `usingPollingFallback` — when
  // the socket is healthy, we DON'T poll (the client's `resumeSync` already
  // does the catch-up fetch on reconnect).
  const clientRef = useRef<OrderRealtimeClient | null>(null);
  // `pollActiveRef` lets the fetcher short-circuit when polling is paused
  // (avoids a stale-closure race where the hook flips `usingPollingFallback`
  // to false but a fetcher in-flight still fires).
  const pollActiveRef = useRef(false);

  // The polling fetcher — only fires when `pollActiveRef.current === true`.
  // Returning `ok: false, status: 0` when paused keeps `useTrackPoll` idle
  // without surfacing an error to the host.
  const fetcher = useCallback(async (): Promise<FetchResult<TrackPayload>> => {
    if (!orderToken || !pollActiveRef.current) {
      return { ok: false, status: 0 };
    }
    try {
      const res = await fetch(`/api/v1/o/${orderToken}`, {
        headers: { Accept: 'application/json' },
      });
      const d = (await res.json()) as { data?: TrackPayload; error?: { message?: string } };
      if (res.ok) {
        return { ok: true, status: res.status, data: d.data ?? {} };
      }
      return {
        ok: false,
        status: res.status,
        message: d?.error?.message ?? (res.status === 404 ? 'Order not found' : 'Could not load this order'),
      };
    } catch {
      return { ok: false, status: 0, message: 'Network error' };
    }
  }, [orderToken]);

  // Drive the polling fallback through useTrackPoll. The hook's own deps
  // re-arm polling whenever `orderToken` changes. We pass a stable fetcher
  // (deps: [orderToken]) so the hook doesn't churn.
  const poll = useTrackPoll<TrackPayload>(fetcher, [orderToken]);

  // Lift the polled status into our state — but only when polling is active,
  // so a stale `poll.data` from before the socket reconnected doesn't
  // overwrite a fresher socket-driven status.
  useEffect(() => {
    if (!usingPollingFallback) return;
    const next = poll.data?.order?.status;
    if (typeof next === 'string' && next !== status) {
      setStatus(next);
    }
  }, [poll.data, usingPollingFallback, status]);

  // Create + tear down the client on mount/unmount (or when the token changes).
  useEffect(() => {
    if (!orderToken) {
      setStatus(null);
      setIsConnected(false);
      setUsingPollingFallback(false);
      pollActiveRef.current = false;
      return;
    }
    const client = new OrderRealtimeClient(orderToken);
    clientRef.current = client;

    const onStatus: StatusChangeCallback = (next) => setStatus(next);
    client.onStatusChange(onStatus);
    client.onFallback(() => {
      pollActiveRef.current = true;
      setUsingPollingFallback(true);
    });
    client.onReconnectSync(() => {
      // Socket is healthy again → stop polling. The client's resumeSync
      // fetch already updated `status` via onStatusChange.
      pollActiveRef.current = false;
      setUsingPollingFallback(false);
      // Force a polling-tick reset so the next polling cycle (if it ever
      // restarts) begins fresh.
      poll.refresh();
    });

    // Track connection health. The client exposes `isConnected()`; we poll
    // it on a short interval because the client doesn't have a built-in
    // `onConnect`/`onDisconnect` subscription (the state is observable via
    // `isConnected()`). A 1s cadence is cheap and gives the UI a near-real-
    // time connection indicator.
    const connTimer = setInterval(() => {
      setIsConnected(client.isConnected());
    }, 1000);

    client.connect();

    return () => {
      clearInterval(connTimer);
      client.disconnect();
      clientRef.current = null;
      pollActiveRef.current = false;
    };
  }, [orderToken]);

  return { status, isConnected, usingPollingFallback };
}

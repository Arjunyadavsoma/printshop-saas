'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  enqueue as enqueueAction,
  getQueue,
  replayQueue,
  subscribe,
  registerBackgroundSync,
  type QueuedAction,
} from '@/lib/customer/offline-queue';

/**
 * useOfflineQueue — a React hook that exposes the offline action queue.
 *
 * Returns:
 *   - `queue`: the current list of queued actions (oldest first). Re-renders
 *     on every enqueue / clear / replay-write (via the `subscribe` API).
 *   - `enqueueAction`: a stable callback that wraps `enqueue()`. Refuses to
 *     enqueue non-safe actions (order creation, payment) — those throw, and
 *     the calling component should surface an inline error instead.
 *   - `isReplaying`: true while a replay pass is in flight. The UI uses this
 *     to show a "Sending your actions…" indicator.
 *
 * Side effects on mount:
 *   - Subscribes to queue changes (re-renders on enqueue / clear / replay).
 *   - Listens for the `online` event → triggers `replayQueue()`. This is
 *     the fallback path when Background Sync is unavailable (iOS Safari).
 *   - Attempts to register a Background Sync tag (no-op on unsupported
 *     browsers). The SW's `sync` event listener triggers replay.
 *   - If the device is already online AND there are queued actions on
 *     mount, fires a replay immediately (handles the case where the user
 *     came back online in another tab and then opened this one).
 *
 * SSR-safe: returns an empty queue + `enqueueAction` that's a no-op until
 * the hook mounts on the client.
 */
export function useOfflineQueue(): {
  queue: QueuedAction[];
  enqueueAction: (action: Parameters<typeof enqueueAction>[0]) => void;
  isReplaying: boolean;
} {
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);

  // Sync the React state from the source-of-truth (localStorage).
  const sync = useCallback(() => {
    setQueue(getQueue());
  }, []);

  useEffect(() => {
    // Initial sync on mount.
    sync();
    // Re-sync on any queue change (enqueue / clear / replay write).
    const unsub = subscribe(sync);
    return unsub;
  }, [sync]);

  // Replay on `online` event (the Background Sync fallback).
  useEffect(() => {
    let cancelled = false;
    const triggerReplay = async () => {
      if (cancelled) return;
      setIsReplaying(true);
      try {
        await replayQueue();
      } finally {
        if (!cancelled) setIsReplaying(false);
      }
    };
    window.addEventListener('online', triggerReplay);
    // If we're already online on mount + there are queued actions, replay
    // now (covers the case where the user came back online in another tab).
    if (typeof navigator !== 'undefined' && navigator.onLine && getQueue().length > 0) {
      void triggerReplay();
    } else {
      // Best-effort Background Sync registration — the SW fires `sync` on
      // reconnect even if this tab is closed. No-op on iOS Safari.
      void registerBackgroundSync();
    }
    return () => {
      cancelled = true;
      window.removeEventListener('online', triggerReplay);
    };
  }, []);

  // Stable enqueue wrapper — preserves identity across re-renders so callers
  // can use it in useEffect deps without re-firing.
  const enqueueActionStable = useCallback(
    (action: Parameters<typeof enqueueAction>[0]) => {
      try {
        enqueueAction(action);
        // The subscribe listener will trigger sync(); but we also sync
        // immediately so the UI updates before the next event loop tick.
        sync();
      } catch (err) {
        // Re-throw so the calling component can surface the error (e.g.
        // "You're offline — payment can't start until you reconnect").
        // The queue ONLY accepts safe, idempotent actions; a throw here
        // means the caller tried to enqueue something non-safe.
        throw err;
      }
    },
    [sync],
  );

  return { queue, enqueueAction: enqueueActionStable, isReplaying };
}

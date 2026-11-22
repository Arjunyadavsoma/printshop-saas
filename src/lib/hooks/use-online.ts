'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * useOnline — a tiny hook that surfaces `navigator.onLine` and keeps it
 * in sync with the browser's `online` / `offline` events.
 *
 * SSR-safe: returns `true` on the server (the optimistic default) and
 * corrects on the client after mount.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Sync once on mount (handles SSR optimistic default).
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}

/**
 * useShare — wraps `navigator.share` with a graceful fallback to a
 * clipboard copy + a promise that resolves to a short status string
 * ('shared' | 'copied' | 'unsupported') so the host can surface a toast.
 *
 * Mobile browsers (Chrome Android, Safari iOS) implement `navigator.share`.
 * Desktop browsers generally do not — they fall through to clipboard copy.
 */
export function useShare(): (url: string, title: string, text: string) => Promise<'shared' | 'copied' | 'unsupported'> {
  return useCallback(async (url: string, title: string, text: string) => {
    if (typeof navigator === 'undefined') return 'unsupported';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        return 'shared';
      } catch {
        // User dismissed the share sheet — fall back to clipboard copy.
      }
    }
    if (typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        return 'copied';
      } catch {
        return 'unsupported';
      }
    }
    return 'unsupported';
  }, []);
}

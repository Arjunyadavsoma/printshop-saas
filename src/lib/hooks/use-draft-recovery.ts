'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftData,
} from '@/lib/customer/draft-storage';

/**
 * useDraftRecovery — IndexedDB-backed draft recovery for the customer flow.
 *
 * Lifecycle:
 *   1. On mount: load the draft from IndexedDB. If it exists + is less than
 *      2 hours old + matches the current shopSlug, surface it as a
 *      `restoreOffer`. The caller renders a "Restore your previous order?"
 *      UI to let the customer accept or decline.
 *   2. On change: save the current draft to IndexedDB, debounced 500ms so
 *      rapid edits don't thrash the DB.
 *   3. On order placed: the caller invokes `clearDraft()` to wipe the
 *      IndexedDB entry so a future visit starts fresh.
 *
 * The hook is SSR-safe (no IndexedDB access during SSR). All IndexedDB
 * errors are swallowed — the order flow still works without draft recovery.
 */

const DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const SAVE_DEBOUNCE_MS = 500;

export interface UseDraftRecoveryResult {
  /**
   * A draft < 2h old was found on mount. Render a restore UI when non-null.
   * Stays non-null until the caller invokes `dismissRestore` or
   * `clearDraft`. The customer accepting the restore is the caller's
   * responsibility — the hook does not apply the draft to any state.
   */
  restoreOffer: DraftData | null;
  /** Decline the restore offer. Hides the prompt for the rest of this mount. */
  dismissRestore: () => void;
  /**
   * Clear the IndexedDB draft (call after the order is placed). Cancels any
   * pending debounced save first so a post-place save doesn't resurrect the
   * draft.
   */
  clearDraft: () => Promise<void>;
}

/**
 * @param shopSlug The current shop. Only drafts matching this slug are
 *   surfaced as restore offers. When the slug changes, the hook re-loads.
 * @param draft The current draft snapshot to save, or null when there's
 *   nothing to save (e.g. before the first upload). Changes to this value
 *   trigger a debounced save — pass a stable reference when nothing changed.
 */
export function useDraftRecovery(
  shopSlug: string,
  draft: DraftData | null,
): UseDraftRecoveryResult {
  const [restoreOffer, setRestoreOffer] = useState<DraftData | null>(null);
  const restoreCheckedRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount (or when shopSlug changes): load the draft from IndexedDB.
  useEffect(() => {
    if (restoreCheckedRef.current === shopSlug) return;
    restoreCheckedRef.current = shopSlug;
    setRestoreOffer(null);
    let cancelled = false;
    void (async () => {
      const stored = await loadDraft(shopSlug);
      if (cancelled || !stored) return;
      if (stored.shopSlug !== shopSlug) return;
      const age = Date.now() - (stored.updatedAt ?? 0);
      if (age > DRAFT_MAX_AGE_MS) {
        // Too old — purge it so it doesn't show again next visit.
        void clearDraft(shopSlug);
        return;
      }
      setRestoreOffer(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopSlug]);

  // On change: save the draft (debounced 500ms).
  useEffect(() => {
    if (!draft) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveDraft(shopSlug, draft);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [draft, shopSlug]);

  const dismissRestore = useCallback(() => {
    setRestoreOffer(null);
  }, []);

  const clear = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setRestoreOffer(null);
    await clearDraft(shopSlug);
  }, [shopSlug]);

  return { restoreOffer, dismissRestore, clearDraft: clear };
}

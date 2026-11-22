'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * BottomSheet — a modal panel that slides up from the bottom edge.
 *
 * The mobile-native choice for option pickers, "add a coupon", order
 * summaries, payment-method selection. A drag handle at the top is
 * the visual affordance; the radius-soft top corners + sheet shadow
 * (--shadow-sheet) lift it off the page. The sheet is rendered via a
 * portal at document.body so it overlays the AppBar / StickyActionBar
 * without z-index gymnastics.
 *
 * Accessibility is strict (WCAG 2.2 AA + WAI-ARIA dialog pattern):
 *   - Focus is trapped inside (Tab cycles within; Shift+Tab wraps).
 *   - On open, focus moves to the first focusable element (or the
 *     sheet itself); on close, focus restores to the element that
 *     had it before opening.
 *   - Escape and backdrop-tap both close it.
 *   - Body scroll is locked while open (overflow: hidden), restored
 *     on close.
 *   - `aria-modal="true"` hides the rest of the page from AT.
 *
 * Entry animation uses tw-animate-css (already imported in
 * globals.css). Exit animation is intentionally omitted — the sheet
 * unmounts immediately on close, which keeps the parent's state and
 * the portal's lifecycle in sync. prefers-reduced-motion is handled
 * by a global rule in globals.css that flattens all animations.
 */

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

// Selector for focusable elements inside the sheet. Used by the focus
// trap to find first/last and cycle Tab.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Remember the element that had focus before the sheet opened so we
  // can restore it on close — this is the WAI-ARIA dialog pattern.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Body scroll lock + Escape listener + focus management.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;

    // Lock body scroll. We capture the previous inline overflow so we
    // can restore it exactly (avoiding clobbering other styles).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    // Capture so we intercept before any child handler — Escape should
    // always close the sheet, even if a child listens for it.
    document.addEventListener('keydown', onKey, true);

    // Move focus into the sheet on the next tick (after the portal has
    // painted). requestAnimationFrame avoids a focus race with React's
    // commit phase.
    const raf = requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      // Ensure the sheet itself is focusable as a fallback.
      sheet.tabIndex = -1;
      const first = sheet.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? sheet).focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  // Focus trap: Tab cycles within the sheet.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusables = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      sheet.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      // Shift+Tab from the first focusable wraps to the last.
      if (active === first || active === sheet || !sheet.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab from the last focusable wraps to the first.
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // SSR guard: portals need a real document. On the server, render
  // nothing — the open prop is false during SSR anyway in practice.
  if (typeof document === 'undefined') return null;
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="presentation"
    >
      {/*
        Backdrop: semi-transparent ink overlay. A tap on the backdrop
        (not on the sheet) closes the sheet. We stop the sheet's
        pointer events from bubbling to the backdrop via a separate
        onClick handler on the sheet wrapper.
      */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--color-ink)]/40 animate-in fade-in duration-200"
      />

      {/*
        Sheet: max-w-[480px] so it stays phone-width on desktop too.
        max-h-[90dvh] + overflow-y-auto so tall content scrolls inside
        the sheet rather than pushing the drag handle off-screen.
        safe-bottom respects the iOS home indicator.
      */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={[
          'relative w-full max-w-[480px]',
          'bg-[var(--color-surface)] rounded-t-[var(--radius-soft)]',
          'shadow-[var(--shadow-sheet)]',
          'max-h-[90dvh] overflow-y-auto',
          'safe-bottom',
          'animate-in slide-in-from-bottom duration-300 ease-out',
        ].join(' ')}
      >
        {/* Drag handle — a small rounded bar. Decorative only. */}
        <div className="flex justify-center pt-3 pb-1">
          <span
            className="block w-10 h-1.5 rounded-full bg-[var(--color-border-ink-strong)]"
            aria-hidden="true"
          />
        </div>

        {/* Optional header with title + close affordance. */}
        {title && (
          <div className="flex items-center justify-between gap-2 px-4 pb-2">
            <h2 className="text-base font-semibold text-[var(--color-ink)] truncate">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="touch-target flex items-center justify-center -mr-2 text-[var(--color-muted)]"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Body. The consumer supplies whatever content they need. */}
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default BottomSheet;

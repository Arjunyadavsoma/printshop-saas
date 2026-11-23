'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * Clear design system — sheet.
 *
 * A modal panel that adapts to viewport:
 *  - Mobile (< 768px) : bottom sheet, radius 28 top (--radius-sheet),
 *                       slides up from the bottom edge, max 90dvh, drag
 *                       handle on top, safe-area-aware bottom padding.
 *  - Desktop (>= 768px): right drawer, 400px wide, full height, slides in
 *                       from the right edge, radius 0 (flush to the viewport
 *                       edge).
 *
 * Accessibility (WAI-ARIA dialog pattern, strict):
 *  - Focus is trapped inside (Tab cycles within; Shift+Tab wraps).
 *  - On open, focus moves to the first focusable element (or the panel);
 *    on close, focus restores to the element that had it before opening
 *    (the trigger).
 *  - Escape closes. Backdrop tap closes.
 *  - Body scroll is locked while open, restored on close.
 *  - `aria-modal="true"` hides the rest of the page from AT.
 *
 * Animation: framer-motion drives the slide + fade. Under
 * `prefers-reduced-motion` the slide collapses to a fade only.
 */

export interface SheetProps {
  /** Whether the sheet is open. */
  open: boolean;
  /** Called when the sheet requests to close (Escape, backdrop tap, close button). */
  onClose: () => void;
  /** Optional heading rendered in the header. */
  title?: string;
  /** Optional ARIA label when no title is provided. */
  ariaLabel?: string;
  /** The sheet body. */
  children: ReactNode;
  /** Optional footer pinned to the bottom of the sheet (e.g. a primary CTA). */
  footer?: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Sheet({ open, onClose, title, ariaLabel, children, footer }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();

  // Focus management + body scroll lock + Escape listener + back-gesture close.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);

    // Back-gesture / browser-back close: push a sentinel history entry so
    // the next popstate (back button / swipe) closes the sheet instead of
    // navigating away. We clean up by popping the sentinel on close.
    let pushed = false;
    const onPopState = () => {
      onClose();
    };
    try {
      window.history.pushState({ sheetOpen: true }, '');
      pushed = true;
      window.addEventListener('popstate', onPopState);
    } catch {
      // pushState can throw in sandboxed iframes; ignore — Escape + backdrop
      // tap still close the sheet.
    }

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      panel.tabIndex = -1;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('popstate', onPopState);
      if (pushed) {
        // Pop the sentinel history entry. If the user already hit back
        // (which fired popstate), this is a no-op; otherwise it removes
        // the sentinel so it doesn't linger in the history stack.
        try {
          window.history.back();
        } catch {
          // ignore
        }
      }
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  // Focus trap: Tab cycles within the panel.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || active === panel || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // SSR guard: portals need a real document.
  if (typeof document === 'undefined') return null;

  // Mobile = bottom sheet layout; Desktop = right drawer layout.
  const containerClass = isMobile
    ? 'fixed inset-0 z-50 flex items-end justify-center'
    : 'fixed inset-0 z-50 flex items-stretch justify-end';

  // Animation variants: mobile slides up, desktop slides from right.
  // Reduced motion → fade only (no translate).
  const panelVariants = isMobile
    ? {
        initial: reduceMotion ? { opacity: 0 } : { y: '100%', opacity: 0 },
        animate: reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 },
        exit: reduceMotion ? { opacity: 0 } : { y: '100%', opacity: 0 },
      }
    : {
        initial: reduceMotion ? { opacity: 0 } : { x: '100%', opacity: 0 },
        animate: reduceMotion ? { opacity: 1 } : { x: 0, opacity: 1 },
        exit: reduceMotion ? { opacity: 0 } : { x: '100%', opacity: 0 },
      };

  const panelClass = isMobile
    ? [
        'relative w-full max-w-[480px]',
        'bg-[var(--surface)] rounded-t-[var(--radius-sheet)]',
        'shadow-[var(--shadow-pop)]',
        'max-h-[90dvh] overflow-y-auto',
        'safe-bottom',
        'flex flex-col',
      ].join(' ')
    : [
        'relative w-[400px] h-full',
        'bg-[var(--surface)]',
        'shadow-[var(--shadow-pop)]',
        'overflow-y-auto',
        'flex flex-col',
      ].join(' ');

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={containerClass} role="presentation">
          {/* Backdrop — frosted (semi-transparent + blur) */}
          <motion.div
            aria-hidden="true"
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : ariaLabel ?? 'Dialog'}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={panelVariants}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={panelClass}
          >
            {/* Drag handle — mobile only, decorative. */}
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <span
                  className="block w-10 h-1.5 rounded-full bg-[var(--track)]"
                  aria-hidden="true"
                />
              </div>
            )}

            {/* Header */}
            {(title || !isMobile) && (
              <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
                {title ? (
                  <h2
                    id={titleId}
                    className="text-lg font-semibold text-[var(--label)] truncate"
                  >
                    {title}
                  </h2>
                ) : (
                  <span className="flex-1" />
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="inline-flex items-center justify-center size-10 -mr-2 text-[var(--label-2)] hover:bg-[var(--fill)] rounded-full transition-colors"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 px-4 pb-4 overflow-y-auto">{children}</div>

            {/* Optional footer */}
            {footer && (
              <div className="shrink-0 px-4 pt-2 pb-4 border-t border-[var(--hairline)]">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export { Sheet as ClearSheet };
export default Sheet;

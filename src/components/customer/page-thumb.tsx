'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { type PageMode } from './tokens';

/**
 * PageThumb — the signature element of the customer upload flow.
 *
 * A small "paper sheet" (aspect 3:4, A4 proportions) whose texture encodes
 * the colour mode the customer has chosen for that page:
 *
 *   bw     →  `.halftone-bw`     black dots on white   + "B&W" label
 *   colour →  `.halftone-colour` magenta with cyan rosette + "Colour" label + CMYK dots
 *   skip   →  `.halftone-skip`   greyed dashed         + "Skip" label
 *
 * COLOUR IS NEVER THE ONLY SIGNAL — every mode ships with a texture AND a
 * text label. The colour mode additionally shows a four-dot CMYK glyph
 * (cyan / magenta / yellow / key-black) so a colour-blind customer still
 * sees "this is the colour page" without relying on hue.
 *
 * Tap toggles the mode on a 3-state cycle: bw → colour → skip → bw.
 * Each toggle plays the .page-flip animation (200ms Y-axis rotation,
 * already prefers-reduced-motion aware in globals.css).
 *
 * Long-press (500ms) enters multi-select mode — the parent PageStrip
 * receives the page number and can ring subsequent taps.
 *
 * When `selected` is true the thumb gets a 2px cyan-ink ring so the
 * customer can see exactly which pages are in the current selection.
 *
 * Minimum touch target: the thumb renders ~100px wide in a 3-col grid on
 * 360px screens — well above the 48px WCAG minimum. The hit area is the
 * whole thumb, not just the label.
 */

export interface PageThumbProps {
  pageNumber: number;
  mode: PageMode;
  onToggle: () => void;
  /** Long-press handler — page number is the parent's responsibility. */
  onLongPress?: () => void;
  /** True while this page is part of the multi-select set. */
  selected?: boolean;
  /** Long-press threshold in ms (default 500). */
  longPressDelay?: number;
  className?: string;
}

const MODE_LABEL: Record<PageMode, string> = {
  bw: 'B&W',
  colour: 'Colour',
  skip: 'Skip',
};

/**
 * Four-dot CMYK glyph — shown only on colour-mode thumbs so the page can
 * be identified without relying on hue alone. The four dots sit on a
 * surface chip with a hairline border so they stay legible over the
 * magenta halftone texture.
 */
function CmykDots() {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-[2px] bg-[var(--color-surface)]/95 border border-[var(--color-border-ink)]"
      aria-hidden="true"
    >
      <span className="size-1 rounded-full" style={{ backgroundColor: 'var(--color-cyan-ink)' }} />
      <span className="size-1 rounded-full" style={{ backgroundColor: 'var(--color-magenta-ink)' }} />
      <span className="size-1 rounded-full" style={{ backgroundColor: 'var(--color-yellow-ink)' }} />
      <span className="size-1 rounded-full" style={{ backgroundColor: 'var(--color-ink)' }} />
    </span>
  );
}

const TEXTURE_CLASS: Record<PageMode, string> = {
  bw: 'halftone-bw',
  colour: 'halftone-colour',
  skip: 'halftone-skip',
};

// Label legibility: B&W and Skip labels sit on the texture directly, so
// they get a surface chip. The Colour label sits on the magenta texture
// so it gets a surface chip too — consistent readability across modes.
const LABEL_TEXT_CLASS: Record<PageMode, string> = {
  bw: 'text-[var(--color-ink)]',
  colour: 'text-[var(--color-ink)]',
  skip: 'text-[var(--color-muted)]',
};

export function PageThumb({
  pageNumber,
  mode,
  onToggle,
  onLongPress,
  selected = false,
  longPressDelay = 500,
  className = '',
}: PageThumbProps) {
  // The flip animation retriggers by toggling a class on/off. We add
  // `page-flip` immediately on toggle and clear it onAnimationEnd so the
  // next toggle can replay the keyframe.
  const [flipping, setFlipping] = useState(false);

  // Long-press bookkeeping — kept in refs so we don't re-render on every
  // pointermove. `longPressFired` blocks the subsequent click from also
  // toggling the mode, so a long-press doesn't double-act.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Cleanup on unmount — don't leak a timer that fires after we're gone.
  useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  const handleToggle = useCallback(() => {
    setFlipping(true);
    onToggle();
  }, [onToggle]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      // Only respond to primary button / touch contact.
      if (e.button !== undefined && e.button !== 0) return;
      longPressFired.current = false;
      pointerStart.current = { x: e.clientX, y: e.clientY };

      if (onLongPress) {
        clearLongPressTimer();
        longPressTimer.current = setTimeout(() => {
          longPressFired.current = true;
          onLongPress();
        }, longPressDelay);
      }
    },
    [onLongPress, longPressDelay, clearLongPressTimer],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      // If the customer drags more than ~10px we treat it as a scroll, not
      // a press — cancel the long-press timer so scrolling a 500-page grid
      // doesn't accidentally ring pages.
      if (!pointerStart.current || longPressTimer.current === null) return;
      const dx = Math.abs(e.clientX - pointerStart.current.x);
      const dy = Math.abs(e.clientY - pointerStart.current.y);
      if (dx > 10 || dy > 10) {
        clearLongPressTimer();
      }
    },
    [clearLongPressTimer],
  );

  const onPointerUp = useCallback(() => {
    clearLongPressTimer();
    // If the long-press already fired, swallow the click — we don't want
    // a long-press to ALSO toggle the mode.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    handleToggle();
  }, [clearLongPressTimer, handleToggle]);

  const onPointerLeave = useCallback(() => {
    // Pointer leaving the thumb while pressed — cancel the long-press.
    // We do NOT toggle here (the customer may have just dragged out).
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  const accessibleName = `Page ${pageNumber}, ${MODE_LABEL[mode]}${selected ? ', selected' : ''}. Tap to change colour mode.`;

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={clearLongPressTimer}
      onAnimationEnd={() => setFlipping(false)}
      aria-label={accessibleName}
      aria-pressed={selected || undefined}
      className={[
        'relative block w-full',
        'aspect-[3/4]',
        'rounded-[var(--radius-tight)]',
        'overflow-hidden',
        'touch-target', // guarantees ≥48px in both axes even if the grid shrinks
        'outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-cyan-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)]',
        // Selected ring — 2px cyan-ink, drawn OUTSIDE the thumb via box-shadow
        // so the texture inside isn't clipped by the rounded border.
        selected
          ? 'ring-2 ring-[var(--color-cyan-ink)] ring-offset-1 ring-offset-[var(--color-paper)]'
          : '',
        className,
      ].join(' ')}
    >
      {/* Texture layer — fills the thumb, carries the halftone class.
          The flipping class lives here so the Y-axis rotation pivots
          around the paper's vertical centre. */}
      <span
        className={[
          'absolute inset-0 block',
          TEXTURE_CLASS[mode],
          flipping ? 'page-flip' : '',
        ].join(' ')}
        aria-hidden="true"
      />

      {/* Page number — top-left, small, tabular nums so the column aligns.
          On the colour texture we use a surface chip for legibility; on
          bw/skip the texture is light enough that ink text reads directly. */}
      <span
        className={[
          'absolute top-1 left-1 px-1 py-0.5 rounded-[2px]',
          'text-[10px] font-medium tnum leading-none',
          mode === 'colour'
            ? 'bg-[var(--color-surface)]/95 text-[var(--color-ink)]'
            : 'text-[var(--color-muted)]',
        ].join(' ')}
        aria-hidden="true"
      >
        {pageNumber}
      </span>

      {/* Bottom label — mode name + (for colour) the CMYK glyph.
          Lives on a surface chip so it stays readable over every texture. */}
      <span className="absolute bottom-1 left-1 right-1 flex items-center justify-center gap-1">
        <span
          className={[
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px]',
            'text-[10px] font-medium leading-none',
            'bg-[var(--color-surface)]/95',
            'border border-[var(--color-border-ink)]',
            LABEL_TEXT_CLASS[mode],
          ].join(' ')}
          aria-hidden="true"
        >
          {mode === 'colour' && <CmykDots />}
          <span>{MODE_LABEL[mode]}</span>
        </span>
      </span>

      {/* Selected check glyph — small, top-right, only when selected.
          A second visual confirmation alongside the ring. */}
      {selected && (
        <span
          className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-[var(--color-cyan-ink)] text-white"
          aria-hidden="true"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 5l2 2 4-4" />
          </svg>
        </span>
      )}
    </button>
  );
}

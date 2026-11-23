'use client';

import { useState, useRef, type ReactNode } from 'react';
import { type PageMode } from './tokens';

/**
 * PageTile — the signature moment of the Clear design system.
 *
 * Each page is a paper tile (aspect-[3/4], radius 12, fill var(--fill)) with:
 * - Page number top-left (12/600, label-2)
 * - A 14px dot top-right:
 *   - B&W: half black / half white with 1px #6B6F76 ring (conic gradient)
 *   - Colour: rainbow conic gradient
 *   - Skip: greyed out (label-3)
 * - A white pill label bottom-left: "B&W" / "Colour" / "Skip"
 * - Colour tiles get the pastel gradient background (var(--pg-colour-bg))
 *
 * Tap cycles: bw → colour → skip → bw.
 * The `.page-tile-flip` class plays a 150ms scale animation on toggle.
 *
 * Colour is NEVER the only signal: the dot + the pill label + the tile
 * background all change together.
 *
 * Keyboard: Space/Enter toggles. Long-press (500ms) enters multi-select.
 */

interface PageTileProps {
  pageNumber: number;
  mode: PageMode;
  onToggle: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  /** Thumbnail URL (lazy-loaded). If absent, shows the dot/tint pattern only. */
  thumbnailUrl?: string;
}

export function PageTile({ pageNumber, mode, onToggle, onLongPress, selected, thumbnailUrl }: PageTileProps) {
  const [flipping, setFlipping] = useState(false);

  const handleToggle = () => {
    setFlipping(true);
    onToggle();
  };

  // Long-press detection
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePointerDown = () => {
    if (!onLongPress) return;
    longPressTimer.current = setTimeout(() => onLongPress(), 500);
  };
  const handlePointerUp = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const isColour = mode === 'colour';
  const isBw = mode === 'bw';
  const isSkip = mode === 'skip';

  return (
    <button
      onClick={handleToggle}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onAnimationEnd={() => setFlipping(false)}
      aria-label={`Page ${pageNumber}: ${mode === 'bw' ? 'black and white' : mode === 'colour' ? 'colour' : 'skipped'}. Tap to change.`}
      aria-pressed={isColour}
      className={[
        'relative aspect-[3/4] rounded-[var(--radius-thumb)] overflow-hidden touch-target',
        'transition-shadow duration-150',
        flipping ? 'page-tile-flip' : '',
        selected ? 'ring-2 ring-[var(--accent)] ring-offset-2' : '',
        isSkip ? 'opacity-50' : '',
      ].join(' ')}
      style={{
        backgroundColor: isColour ? undefined : 'var(--fill)',
        backgroundImage: isColour ? 'var(--pg-colour-bg)' : undefined,
      }}
    >
      {/* Page number top-left */}
      <span className="absolute top-1.5 left-1.5 text-[12px] font-semibold text-[var(--label-2)] tnum z-10">
        {pageNumber}
      </span>

      {/* Dot top-right */}
      <span
        className="absolute top-1.5 right-1.5 size-3.5 rounded-full z-10"
        style={{
          background: isBw
            ? 'var(--pg-bw-dot)'
            : isColour
              ? 'var(--pg-colour-dot)'
              : 'var(--label-3)',
          boxShadow: isBw ? '0 0 0 1px var(--label-3)' : 'none',
        }}
        aria-hidden="true"
      />

      {/* Thumbnail (if available) */}
      {thumbnailUrl && !isSkip && (
        
        <img
          src={thumbnailUrl}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-80"
          loading="lazy"
        />
      )}

      {/* Pill label bottom-left */}
      <span
        className={[
          'absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full text-[12px] font-semibold z-10',
          isBw
            ? 'bg-white text-[var(--label)]'
            : isColour
              ? 'bg-white text-[var(--label)]'
              : 'bg-[var(--surface)] text-[var(--label-3)]',
        ].join(' ')}
      >
        {isBw ? 'B&W' : isColour ? 'Colour' : 'Skip'}
      </span>
    </button>
  );
}

/** Running totals above the strip: "12 B&W · 3 Colour · 2 skip" */
export function ColourSummary({ bw, colour, skip }: { bw: number; colour: number; skip: number }) {
  const parts: ReactNode[] = [];
  if (bw > 0) parts.push(<span key="bw">{bw} B&W</span>);
  if (colour > 0) parts.push(<span key="colour">{colour} colour</span>);
  if (skip > 0) parts.push(<span key="skip">{skip} skip</span>);
  if (parts.length === 0) parts.push(<span key="none" className="text-[var(--label-3)]">No pages</span>);

  return (
    <p className="text-[13px] text-[var(--label-2)] tnum flex items-center gap-2">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-[var(--label-3)]">·</span>}
          {p}
        </span>
      ))}
    </p>
  );
}

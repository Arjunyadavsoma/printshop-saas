'use client';

import { type CSSProperties } from 'react';

/**
 * Skeleton primitives for the customer flow.
 *
 * Loading placeholders that mirror the dimensions of the real content, so
 * the layout never shifts when data arrives. The shimmer is muted/paper
 * tinted (not generic neutral grey) to stay on-brand with the CMYK
 * process-ink palette — the fill is derived from `--color-muted` at low
 * opacity, which reads as a soft pencil-mark rather than a flat grey box.
 *
 * Animation: `animate-pulse` (Tailwind built-in) — a slow opacity breathe,
 * subtle rather than aggressive. The global `prefers-reduced-motion` rule
 * in globals.css clamps every animation to ~0ms, so these fall back to a
 * static muted fill automatically; we also add an explicit
 * `motion-reduce:animate-none` belt-and-braces.
 *
 * All primitives are `aria-hidden` — skeletons are decoration for sighted
 * users; a screen-reader user hears nothing until the real content mounts.
 */

/** Resolve a width/height prop that may be a number (px) or a CSS string. */
function toCssSize(value: number | string | undefined, fallback?: string): string | undefined {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' ? `${value}px` : value;
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonBox
// ─────────────────────────────────────────────────────────────────────────────

interface SkeletonBoxProps {
  /** Width in px or any CSS length. Omit to fill the parent. */
  width?: number | string;
  /** Height in px or any CSS length. */
  height?: number | string;
  /** Border radius as a CSS string. Defaults to the design-system default radius. */
  radius?: string;
  /** Extra classes (e.g. layout overrides). */
  className?: string;
}

/**
 * SkeletonBox — a single shimmer box. The atom every other skeleton is
 * built from. Muted-tinted fill + `animate-pulse`.
 */
export function SkeletonBox({
  width,
  height,
  radius = 'var(--radius-default)',
  className = '',
}: SkeletonBoxProps) {
  const style: CSSProperties = {
    width: toCssSize(width),
    height: toCssSize(height),
    borderRadius: radius,
  };
  return (
    <div
      aria-hidden="true"
      style={style}
      className={[
        // Muted-derived tint (not neutral grey) — the pencil-mark colour.
        'bg-[rgb(91_102_117_/_0.14)]',
        'animate-pulse motion-reduce:animate-none',
        className,
      ].join(' ')}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonText
// ─────────────────────────────────────────────────────────────────────────────

/** Map the named width presets to percentages of the available width. */
const TEXT_WIDTHS: Record<'short' | 'medium' | 'long', string> = {
  short: '40%',
  medium: '70%',
  long: '100%',
};

interface SkeletonTextProps {
  /** Number of lines to stack. Defaults to 1. */
  lines?: number;
  /** Width preset for the block. Defaults to 'long'. */
  width?: 'short' | 'medium' | 'long';
  /** Extra classes. */
  className?: string;
}

/**
 * SkeletonText — one or more text-line skeletons at a configurable width.
 *
 * When more than one line is rendered, the last line is shortened (~85%)
 * so the block reads as natural ragged-right text rather than a barcode.
 */
export function SkeletonText({
  lines = 1,
  width = 'long',
  className = '',
}: SkeletonTextProps) {
  const baseWidth = TEXT_WIDTHS[width];
  // Shorten the final line for a natural paragraph silhouette.
  const lastWidth = lines > 1 ? `calc(${baseWidth} * 0.85)` : baseWidth;
  return (
    <div
      aria-hidden="true"
      className={['flex flex-col gap-1.5', className].join(' ')}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox
          key={i}
          height={12}
          width={i === lines - 1 ? lastWidth : baseWidth}
          radius="var(--radius-tight)"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonCard
// ─────────────────────────────────────────────────────────────────────────────

interface SkeletonCardProps {
  /** Extra classes (e.g. to set a fixed width). */
  className?: string;
}

/**
 * SkeletonCard — a card-shaped skeleton shaped like a shop card or a file
 * card: a leading 40px mark (shop icon / file thumbnail), a title line,
 * and a subtitle line. Same surface/border as a real card so the swap-in
 * is invisible.
 */
export function SkeletonCard({ className = '' }: SkeletonCardProps) {
  return (
    <div
      aria-hidden="true"
      className={[
        'rounded-[var(--radius-default)]',
        'border border-[var(--color-border-ink)]',
        'bg-[var(--color-surface)]',
        'p-4',
        className,
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        {/* Leading mark — icon box (shop) / thumbnail (file) */}
        <SkeletonBox width={40} height={40} radius="var(--radius-default)" />
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <SkeletonText lines={1} width="medium" />
          <SkeletonText lines={1} width="short" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonPageStrip
// ─────────────────────────────────────────────────────────────────────────────

interface SkeletonPageStripProps {
  /** How many page tiles to render. Defaults to 8. */
  count?: number;
  /** Extra classes. */
  className?: string;
}

/**
 * SkeletonPageStrip — placeholder for the page strip: a row of equal page
 * tiles (the grid of B&W / Colour / Skip thumbnails). Each tile is a
 * muted box at the same height as a real page tile so the strip occupies
 * the same space before the real page modes resolve.
 *
 * `role="status"` so assistive tech announces "loading" once; the inner
 * boxes stay `aria-hidden`.
 */
export function SkeletonPageStrip({ count = 8, className = '' }: SkeletonPageStripProps) {
  return (
    <div
      role="status"
      aria-label="Loading pages"
      className={['grid gap-2', className].join(' ')}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox
          key={i}
          width="100%"
          height={48}
          radius="var(--radius-tight)"
        />
      ))}
    </div>
  );
}

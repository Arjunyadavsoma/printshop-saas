'use client';

import { type CSSProperties } from 'react';

/**
 * Clear design system — skeleton shimmer placeholders.
 *
 * Loading placeholders that mirror the dimensions of the real content, so
 * the layout never shifts when data arrives. The shimmer is the global
 * `.skeleton-shimmer` utility from globals.css — a soft white gradient
 * sweeping left-to-right over a muted fill (`--fill`), 1.6s loop, clamped
 * to ~0ms under `prefers-reduced-motion`.
 *
 * Variants:
 *  - SkeletonLabel    : a short 12px-tall bar (a label / eyebrow line)
 *  - SkeletonSecondary: a 14px-tall bar (secondary / body text)
 *  - SkeletonCard     : a full card (leading mark + title + subtitle)
 *  - SkeletonPageStrip: a row of equal page tiles (the page grid placeholder)
 *
 * All primitives are `aria-hidden` — skeletons are decoration for sighted
 * users; a screen-reader user hears nothing until the real content mounts.
 * The compound variants (Card, PageStrip) wrap their inner boxes in a
 * `role="status"` container so assistive tech announces "loading" once.
 */

/** Resolve a width/height prop that may be a number (px) or a CSS string. */
function toCssSize(value: number | string | undefined, fallback?: string): string | undefined {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' ? `${value}px` : value;
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonBox — the atom
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonBoxProps {
  /** Width in px or any CSS length. Omit to fill the parent. */
  width?: number | string;
  /** Height in px or any CSS length. */
  height?: number | string;
  /** Border radius as a CSS string. Defaults to the input radius (12px). */
  radius?: string;
  /** Extra classes (e.g. layout overrides). */
  className?: string;
}

/** A single shimmer box. Built from the global `.skeleton-shimmer` utility. */
export function SkeletonBox({
  width,
  height,
  radius = 'var(--radius-input)',
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
        'bg-[var(--fill)] skeleton-shimmer',
        className,
      ].join(' ')}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonLabel — a short label / eyebrow line
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonLabelProps {
  /** Width preset. Defaults to "short". */
  width?: 'short' | 'medium' | 'long';
  className?: string;
}

/** A 12px-tall bar — represents a label, eyebrow, or caption. */
export function SkeletonLabel({ width = 'short', className = '' }: SkeletonLabelProps) {
  const w = width === 'short' ? '40%' : width === 'medium' ? '65%' : '100%';
  return <SkeletonBox height={12} width={w} radius="var(--radius-input)" className={className} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonSecondary — a body / secondary text line
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonSecondaryProps {
  /** Number of lines to stack. Defaults to 1. */
  lines?: number;
  /** Width preset for the block. Defaults to 'long'. */
  width?: 'short' | 'medium' | 'long';
  className?: string;
}

/** One or more 14px-tall text-line skeletons. */
export function SkeletonSecondary({
  lines = 1,
  width = 'long',
  className = '',
}: SkeletonSecondaryProps) {
  const base = width === 'short' ? '40%' : width === 'medium' ? '70%' : '100%';
  const lastWidth = lines > 1 ? `calc(${base} * 0.85)` : base;
  return (
    <div aria-hidden="true" className={['flex flex-col gap-1.5', className].join(' ')}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox
          key={i}
          height={14}
          width={i === lines - 1 ? lastWidth : base}
          radius="var(--radius-input)"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonCard — a file / shop card placeholder
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonCardProps {
  className?: string;
}

/**
 * A card-shaped skeleton: a leading 40px mark + a title line + a subtitle
 * line. Same surface + radius as a real card so the swap-in is invisible.
 */
export function SkeletonCard({ className = '' }: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={[
        'rounded-[var(--radius-card)]',
        'bg-[var(--surface)]',
        'p-4',
        className,
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <SkeletonBox width={40} height={40} radius="var(--radius-card)" />
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <SkeletonSecondary lines={1} width="medium" />
          <SkeletonSecondary lines={1} width="short" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonPageStrip — the page-tile grid placeholder
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonPageStripProps {
  /** How many page tiles to render. Defaults to 8. */
  count?: number;
  className?: string;
}

/** A row of equal page tiles — the page-mode grid placeholder. */
export function SkeletonPageStrip({ count = 8, className = '' }: SkeletonPageStripProps) {
  return (
    <div
      role="status"
      aria-label="Loading pages"
      className={['grid gap-2', className].join(' ')}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox key={i} width="100%" height={48} radius="var(--radius-input)" />
      ))}
    </div>
  );
}

export {
  SkeletonBox as ClearSkeletonBox,
  SkeletonLabel as ClearSkeletonLabel,
  SkeletonSecondary as ClearSkeletonSecondary,
  SkeletonCard as ClearSkeletonCard,
  SkeletonPageStrip as ClearSkeletonPageStrip,
};
export default SkeletonBox;

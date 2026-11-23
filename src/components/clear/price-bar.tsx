'use client';

import { type ReactNode } from 'react';

/**
 * Clear design system — price bar.
 *
 * A frosted, sticky bottom bar that holds the live total + the primary CTA.
 * Pinned to the bottom of the viewport (or the nearest scroll container),
 * safe-area aware (respects the iOS home indicator via `.safe-bottom-bar`).
 *
 * Layout:
 *  - Left  : a caption (13px, label-2) stacked over the total (24px / 700,
 *            tabular-nums, label colour). The caption is the aria-live
 *            region so screen readers announce the total as it changes.
 *  - Right : the primary action (typically a PrimaryButton). The caller
 *            passes it as `action`.
 *
 * The bar uses the global `.frosted-bar` utility (rgba white + backdrop
 * blur) so content scrolling underneath is visible through it — the bar
 * feels like it floats over the page rather than occluding it. Under
 * `prefers-reduced-transparency` the utility falls back to a solid surface.
 *
 * A top hairline (not a shadow) encodes the separation — shadows read as
 * heavy on a frosted surface.
 */

export interface PriceBarProps {
  /** Short caption above the total (e.g. "Total", "To pay"). */
  caption?: string;
  /** The live total — a string (e.g. "₹48") or any ReactNode. */
  total: ReactNode;
  /** The primary action button (usually <PrimaryButton>). */
  action: ReactNode;
  /** Optional className for the wrapper. */
  className?: string;
}

export function PriceBar({ caption = 'Total', total, action, className = '' }: PriceBarProps) {
  return (
    <div
      className={[
        'sticky bottom-0 z-20',
        'frosted-bar border-t border-[var(--hairline)]',
        'safe-bottom-bar',
        className,
      ].join(' ')}
      role="contentinfo"
    >
      <div className="flex items-center gap-4 px-4 pt-3 pb-1">
        {/* Left: caption + total */}
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-[13px] text-[var(--label-2)] leading-tight">{caption}</span>
          {/*
            aria-live polite + aria-atomic so screen readers announce the
            WHOLE total each time it changes (e.g. "Total ₹124") rather than
            just the diff.
            min-w-[80px] reserves space for up to 4 tabular digits + the
            rupee glyph so the CTA on the right doesn't shift as the price
            widens (₹48 → ₹124).
          */}
          <span
            className="text-2xl font-bold text-[var(--label)] tnum leading-tight min-w-[80px]"
            aria-live="polite"
            aria-atomic="true"
          >
            {total}
          </span>
        </div>

        {/* Right: primary action */}
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}

export { PriceBar as ClearPriceBar };
export default PriceBar;

'use client';

import { type ReactNode } from 'react';

/**
 * StickyActionBar — the bottom bar that holds the primary CTA + live total.
 *
 * Fixed to the bottom of the viewport, safe-area aware (respects the iOS
 * home indicator). The primary action lives here because the bottom third
 * of the screen is the thumb zone on mobile.
 *
 * Shows the live total ("₹48") on the left + the CTA button on the right.
 * A border (not shadow) encodes the separation — the shadow only appears
 * when the bar is floating above scrolled content.
 */

interface StickyActionBarProps {
  /** The live total display (e.g. "₹48" or "12 B&W · 3 Colour"). */
  total?: ReactNode;
  /** The primary action button (usually <PrimaryButton>). */
  children: ReactNode;
}

export function StickyActionBar({ total, children }: StickyActionBarProps) {
  return (
    <div
      className="sticky bottom-0 z-10 bg-[var(--color-surface)] border-t border-[var(--color-border-ink)] shadow-[var(--shadow-bar)] safe-bottom-bar"
      role="contentinfo"
    >
      <div className="flex items-center gap-4 px-4 py-3">
        {total && (
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--color-muted)] leading-tight">Total</p>
            {/*
              `aria-live="polite"` announces the new total to screen-reader
              users as the customer toggles page modes (the value is the
              polite priority so it doesn't interrupt whatever is being
              spoken). `aria-atomic="true"` ensures the region announces the
              WHOLE value each time (e.g. "Total ₹124") rather than just the
              diff ("24"), which would be meaningless without the currency
              symbol.

              `min-w-[80px]` reserves space for the price so the digit width
              doesn't change (₹48 → ₹124) and cause a horizontal layout
              shift in the action bar — the CTA on the right would otherwise
              jump left/right as the price widens. The 80px is sized for up
              to four characters of tabular-numerals at text-xl + the
              rupee glyph + the "Updating…" state.
            */}
            <p
              className="text-xl font-semibold text-[var(--color-ink)] tnum leading-tight min-w-[80px]"
              aria-live="polite"
              aria-atomic="true"
            >
              {total}
            </p>
          </div>
        )}
        <div className={total ? 'shrink-0' : 'flex-1'}>
          {children}
        </div>
      </div>
    </div>
  );
}

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
            <p className="text-xl font-semibold text-[var(--color-ink)] tnum leading-tight">{total}</p>
          </div>
        )}
        <div className={total ? 'shrink-0' : 'flex-1'}>
          {children}
        </div>
      </div>
    </div>
  );
}

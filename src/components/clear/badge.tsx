'use client';

import { type ReactNode } from 'react';

/**
 * Clear design system — count badge.
 *
 * A small circle (min 18px) with a solid accent fill and white (on-accent)
 * text, used to surface an unread count: number of files, items in a cart,
 * pending orders. Always paired with a visible text label nearby — the
 * badge is a glanceable number, not the only signal.
 *
 * Spec:
 *  - min-width 18px, height 18px (grows for multi-digit counts, stays circular for 1-2 digits)
 *  - accent bg, on-accent text, 11px / weight 600
 *  - horizontal padding so multi-digit counts (e.g. "12") don't touch the edges
 *  - tabular numerals so digit width is stable as the count changes
 *
 * For a count of 0 the badge renders nothing (no empty dot) — the absence
 * is the signal. Pass `showZero` to override.
 */

export interface BadgeProps {
  /** The count to display. */
  count: number;
  /** When true, renders even when count is 0. Defaults to false (hidden at 0). */
  showZero?: boolean;
  /** Optional className for layout overrides (positioning). */
  className?: string;
  /** Optional accessible label prefix. Defaults to "N items" / "1 item". */
  ariaLabel?: string;
  /** Optional children to render instead of the count (e.g. a dot). */
  children?: ReactNode;
}

export function Badge({ count, showZero = false, className = '', ariaLabel, children }: BadgeProps) {
  if (count <= 0 && !showZero) return null;
  const label = ariaLabel ?? (count === 1 ? '1 item' : `${count} items`);

  return (
    <span
      role="status"
      aria-label={label}
      className={[
        'inline-flex items-center justify-center',
        'min-w-[18px] h-[18px] px-1.5',
        'rounded-full',
        'bg-[var(--accent)] text-[var(--on-accent)]',
        'text-[11px] font-semibold leading-none tnum',
        'select-none',
        className,
      ].join(' ')}
    >
      {children ?? count}
    </span>
  );
}

export { Badge as ClearBadge };
export default Badge;

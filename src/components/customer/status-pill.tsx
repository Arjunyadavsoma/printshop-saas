'use client';

import { type ReactNode } from 'react';

/**
 * StatusPill — a compact, colour-coded order status indicator.
 *
 * Used inline next to order numbers, in the {@link PriceBreakdown} trailing
 * slot, and in list rows to communicate the order's current state at a
 * glance. The pill is intentionally small (`text-xs`, `px-3 py-1`,
 * `radius-full`) so it fits on a single line beside other content without
 * competing with it.
 *
 * Colour coding (status → bg + text):
 *  - pending   → warning (amber) bg + ink text. Amber always pairs with dark
 *                text per the design system — amber-on-white fails AA at the
 *                small pill size, so we use ink-on-amber.
 *  - printing  → cyan-ink bg + white text. The "in flight" state.
 *  - ready     → success (green) bg + white text. The "come pick it up" state.
 *  - collected → success (green) bg + white text, but a check icon prefix to
 *                distinguish from "ready". Collected is the terminal happy state.
 *  - error     → error (red) bg + white text. Failed / cancelled.
 *
 * Colour is NEVER the only signal: each pill also carries a text label
 * (either the provided `label` prop or a sensible capitalized default), so
 * colour-blind users and screen readers get the same information.
 *
 * The default label map is exported as {@link STATUS_LABELS} so callers can
 * align list-row copy with the pill text without duplicating the strings.
 */

/** The lifecycle states an order can be in. */
export type OrderStatus = 'pending' | 'printing' | 'ready' | 'collected' | 'error';

/** Default human labels for each status. Capitalized for sentence context. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Payment pending',
  printing: 'Printing',
  ready: 'Ready',
  collected: 'Collected',
  error: 'Failed',
};

/** Visual config per status — bg + text colour classes. */
const statusStyles: Record<OrderStatus, string> = {
  pending: 'bg-[var(--color-warning)] text-[var(--color-ink)]',
  printing: 'bg-[var(--color-cyan-ink)] text-white',
  ready: 'bg-[var(--color-success)] text-white',
  collected: 'bg-[var(--color-success)] text-white',
  error: 'bg-[var(--color-error)] text-white',
};

interface StatusPillProps {
  /** The lifecycle status. Drives colour + default label. */
  status: OrderStatus;
  /**
   * Optional override label. When omitted, falls back to the capitalized
   * default from {@link STATUS_LABELS}.
   */
  label?: string;
  /** Optional icon prefix (e.g. a check for "collected"). Decorative. */
  icon?: ReactNode;
}

export function StatusPill({ status, label, icon }: StatusPillProps) {
  const text = label ?? STATUS_LABELS[status];
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5',
        'rounded-full',
        'px-3 py-1',
        'text-xs font-medium',
        'whitespace-nowrap',
        statusStyles[status],
      ].join(' ')}
      // role="status" announces the pill as a live region when used in a
      // dynamically-updating context (e.g. the order page polling for status).
      // Static list rows don't need it but it's harmless there.
      role="status"
    >
      {icon && (
        <span className="inline-flex" aria-hidden="true">
          {icon}
        </span>
      )}
      <span>{text}</span>
    </span>
  );
}

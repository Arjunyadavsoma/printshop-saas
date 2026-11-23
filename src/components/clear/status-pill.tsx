'use client';

import { type ReactNode } from 'react';

/**
 * Clear design system — order status pill.
 *
 * A compact, tinted pill that communicates the order's current lifecycle
 * state at a glance. The Clear design language prefers soft tinted
 * backgrounds with strong status-text colour over solid colour fills,
 * so every state uses its status-tint bg + status-text colour pair —
 * quiet but unambiguous.
 *
 * States (status → tint bg + text colour):
 *  - pending   → warning-tint + warning-text. "Payment pending."
 *  - printing  → accent-tint + accent-tint-text. The "in flight" state.
 *  - ready     → success-tint + success-text. "Come pick it up."
 *  - collected → success-tint + success-text, with a check icon prefix to
 *                distinguish from "ready". The terminal happy state.
 *  - error     → danger-tint + danger-text. Failed / cancelled.
 *
 * Colour is NEVER the only signal: each pill also carries a text label
 * (either the provided `label` prop or a sensible default), so colour-blind
 * users and screen readers get the same information.
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

/** Visual config per status — tint bg + text colour classes. */
const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  printing: 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]',
  ready: 'bg-[var(--success-tint)] text-[var(--success-text)]',
  collected: 'bg-[var(--success-tint)] text-[var(--success-text)]',
  error: 'bg-[var(--danger-tint)] text-[var(--danger-text)]',
};

export interface StatusPillProps {
  /** The lifecycle status. Drives colour + default label. */
  status: OrderStatus;
  /**
   * Optional override label. When omitted, falls back to the default from
   * {@link STATUS_LABELS}.
   */
  label?: string;
  /** Optional icon prefix (e.g. a check for "collected"). Decorative. */
  icon?: ReactNode;
  /** Optional className. */
  className?: string;
}

export function StatusPill({ status, label, icon, className = '' }: StatusPillProps) {
  const text = label ?? STATUS_LABELS[status];
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5',
        'rounded-full',
        'px-2.5 py-0.5',
        'text-xs font-semibold',
        'whitespace-nowrap',
        STATUS_STYLES[status],
        className,
      ].join(' ')}
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

export { StatusPill as ClearStatusPill };
export default StatusPill;

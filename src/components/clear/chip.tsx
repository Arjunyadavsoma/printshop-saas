'use client';

import { useId, type ReactNode } from 'react';

/**
 * Clear design system — chip.
 *
 * A compact selectable pill for secondary, multi-select options: page
 * finishing (Staple, Bind, Laminate), delivery (Pickup, Drop), paper weight.
 *
 * Spec: 12px / weight 600 label, padding 3px 10px, fully rounded.
 *  - Selected   : accent-tint background + accent-tint-text. Strong, clearly
 *                 "on" — but never a solid accent fill (that's reserved for
 *                 the primary button).
 *  - Unselected : fill background + label-2 text. Quiet, but clearly tappable.
 *
 * Selection state is `aria-pressed` (toggle button pattern) — these are
 * NOT a radiogroup because multiple selection is allowed. An optional
 * leading Lucide icon reinforces the choice (colour never carries the
 * signal alone).
 *
 * Touch target: the chip itself is compact (28px tall) but the hit area
 * is padded out to 36px via py-2 + the 12px text, which is below the 44px
 * WCAG minimum — callers should leave breathing room between chips so a
 * thumb can land cleanly. For tightly-packed option rows, use the
 * `radio-row` or `segmented-control` instead, which meet 44px+.
 */

export interface ChipProps {
  /** Visible label. Required — chips are never icon-only. */
  label: string;
  /** Whether the chip is currently selected. */
  selected: boolean;
  /** Click handler. */
  onClick: () => void;
  /** Optional leading icon (Lucide). */
  icon?: ReactNode;
  /** Disable the chip (greys it out, no click). */
  disabled?: boolean;
  /** Optional className. */
  className?: string;
}

export function Chip({ label, selected, onClick, icon, disabled, className = '' }: ChipProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-pressed={selected}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-1.5',
        'min-h-[28px] px-2.5 py-[3px]',
        'rounded-full text-xs font-semibold',
        'transition-colors duration-150 ease-out',
        'disabled:opacity-40 disabled:pointer-events-none',
        selected
          ? 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]'
          : 'bg-[var(--fill)] text-[var(--label-2)]',
        className,
      ].join(' ')}
    >
      {icon && (
        <span className="shrink-0 inline-flex" aria-hidden="true">
          {icon}
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}

/**
 * ChipGroup — a wrapping flex container of Chips with an optional label.
 *
 * The label is a quiet eyebrow (label-3, small) — it names the dimension
 * the chips select along ("Finishing", "Delivery"). The chips wrap to
 * the next line on overflow so long option lists stay tappable on narrow
 * screens. The label is wired to the group via `aria-labelledby` so screen
 * readers announce the context.
 */

export interface ChipGroupProps {
  /** Eyebrow label naming the selection dimension. */
  label?: string;
  /** Chip elements (or any other nodes). */
  children: ReactNode;
  /** Optional className. */
  className?: string;
}

export function ChipGroup({ label, children, className = '' }: ChipGroupProps) {
  // useId is hydration-safe (server + client agree on the value).
  const labelId = useId();
  const groupProps = label ? { 'aria-labelledby': labelId } : {};

  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      {label && (
        <div id={labelId} className="text-xs font-medium text-[var(--label-3)]">
          {label}
        </div>
      )}
      <div className="flex flex-wrap gap-2" role="group" {...groupProps}>
        {children}
      </div>
    </div>
  );
}

export { Chip as ClearChip, ChipGroup as ClearChipGroup };
export default Chip;

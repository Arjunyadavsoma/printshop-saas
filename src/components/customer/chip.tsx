'use client';

import { useId, type ReactNode } from 'react';

/**
 * Chip — a compact, selectable pill for secondary options.
 *
 * Tighter than a button (36px vs 48px) because these are secondary
 * controls, not primary actions: page-finishing choices (Staple,
 * Bind, Laminate), delivery options (Pickup, Drop), paper-weight
 * picks. Multiple can be selected at once — selection is signalled
 * by cyan-ink text + border on a light cyan wash; unselected chips
 * sit in muted text against the surface with a 20% ink border.
 *
 * Selection state is `aria-pressed` (toggle button pattern) — these
 * are NOT a radiogroup because multiple selection is allowed. An
 * optional leading Lucide icon reinforces the choice (color never
 * carries the signal alone).
 */

interface ChipProps {
  /** Visible label. Required — chips are never icon-only. */
  label: string;
  /** Whether the chip is currently selected. */
  selected: boolean;
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
        'min-h-[36px] px-3',
        'rounded-full border text-sm font-medium',
        'transition-colors duration-150',
        'disabled:opacity-50 disabled:pointer-events-none',
        selected
          ? 'border-[var(--color-cyan-ink)] text-[var(--color-cyan-ink)] bg-[var(--color-cyan-ink)]/10'
          : 'border-[var(--color-border-ink-strong)] text-[var(--color-muted)] bg-[var(--color-surface)]',
        className,
      ].join(' ')}
    >
      {icon && (
        <span className="shrink-0" aria-hidden="true">
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
 * The label is a quiet eyebrow (muted, small) — it names the dimension
 * the chips select along ("Finishing", "Delivery"). The chips wrap to
 * the next line on overflow so long option lists stay tappable on
 * narrow screens. The label is wired to the group via
 * `aria-labelledby` so screen readers announce the context.
 */

interface ChipGroupProps {
  /** Eyebrow label naming the selection dimension. */
  label?: string;
  /** Chip elements (or any other nodes). */
  children: ReactNode;
  /** Optional className. */
  className?: string;
}

export function ChipGroup({ label, children, className = '' }: ChipGroupProps) {
  // Generate a stable ID for the label so we can wire aria-labelledby
  // to the group. useId works in both server and client components.
  const labelId = useId();
  const groupProps = label ? { 'aria-labelledby': labelId } : {};

  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      {label && (
        <div id={labelId} className="text-xs font-medium text-[var(--color-muted)]">
          {label}
        </div>
      )}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        {...groupProps}
      >
        {children}
      </div>
    </div>
  );
}

export { Chip as CustomerChip, ChipGroup as CustomerChipGroup };
export default Chip;

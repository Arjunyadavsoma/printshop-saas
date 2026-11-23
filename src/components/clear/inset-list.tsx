'use client';

import { type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * Clear design system — inset list.
 *
 * A stack of rows inside a Group-shaped container (white surface, 22px
 * radius). Rows have a 56px min-height, a hairline divider between rows,
 * and NO divider after the last row — the group's rounded edge is the
 * visual close.
 *
 * Row variants (selectable via the `trailing` prop or the convenience
 * sub-components):
 *  - ChevronRow   : label + subtitle + a right chevron (drill-in affordance).
 *  - ValueRow     : label + a right-aligned value (e.g. "Paper: A4").
 *  - SwitchRow    : label + a Switch on the right (see switch.tsx).
 *  - Custom       : pass any ReactNode as `trailing`.
 *
 * Each row is a <button> when `onClick` is provided (chevron rows), or a
 * <div> when it's display-only (value rows) or holds an interactive child
 * (switch rows — the switch itself is the button).
 */

// ─────────────────────────────────────────────────────────────────────────────
// InsetList — the container
// ─────────────────────────────────────────────────────────────────────────────

export interface InsetListProps {
  /** The rows to render. Use InsetRow / ChevronRow / ValueRow / SwitchRow. */
  children: ReactNode;
  /** Optional ARIA label for the list. */
  ariaLabel?: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export function InsetList({ children, ariaLabel, className = '' }: InsetListProps) {
  return (
    <ul
      className={[
        'bg-[var(--surface)]',
        'rounded-[var(--radius-group)]',
        'shadow-[var(--shadow-card)]',
        'overflow-hidden',
        className,
      ].join(' ')}
      aria-label={ariaLabel}
    >
      {children}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InsetRow — the base row
// ─────────────────────────────────────────────────────────────────────────────

export interface InsetRowProps {
  /** Main label. */
  label: string;
  /** Optional subtitle / context. */
  subtitle?: string;
  /** Optional right-aligned trailing content (value, switch, chevron, custom). */
  trailing?: ReactNode;
  /** Optional leading icon (Lucide). */
  icon?: ReactNode;
  /** When provided, the row becomes a <button> that fires this on click. */
  onClick?: () => void;
  /** Disable the row (only meaningful when onClick is set). */
  disabled?: boolean;
  /** Show a chevron on the right (overrides trailing). */
  chevron?: boolean;
  /** Optional className. */
  className?: string;
}

export function InsetRow({
  label,
  subtitle,
  trailing,
  icon,
  onClick,
  disabled = false,
  chevron = false,
  className = '',
}: InsetRowProps) {
  const Tag = onClick ? 'button' : 'div';
  const trailingNode = chevron ? (
    <ChevronRight className="size-5 text-[var(--label-3)]" aria-hidden="true" />
  ) : (
    trailing
  );

  return (
    <li className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-[var(--hairline)]">
      <Tag
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        disabled={onClick ? disabled : undefined}
        className={[
          'flex items-center gap-3 w-full text-left',
          'min-h-[56px] px-4 py-2',
          'bg-transparent',
          'transition-colors duration-150 ease-out',
          onClick && !disabled ? 'hover:bg-[var(--fill)] active:bg-[var(--fill)] cursor-pointer' : '',
          disabled ? 'opacity-40 cursor-not-allowed' : '',
          'focus:outline-none',
          className,
        ].join(' ')}
      >
        {icon && (
          <span className="shrink-0 inline-flex text-[var(--label-2)]" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-base text-[var(--label)] leading-snug truncate">{label}</span>
          {subtitle && (
            <span className="text-[13px] text-[var(--label-2)] leading-snug truncate">
              {subtitle}
            </span>
          )}
        </div>
        {trailingNode && (
          <span className="shrink-0 inline-flex items-center text-[var(--label-2)]">
            {trailingNode}
          </span>
        )}
      </Tag>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrappers
// ─────────────────────────────────────────────────────────────────────────────

/** A drill-in row: label + subtitle + right chevron. Clicking fires onClick. */
export function ChevronRow({
  label,
  subtitle,
  icon,
  onClick,
  disabled,
}: Omit<InsetRowProps, 'trailing' | 'chevron'> & { onClick: () => void }) {
  return (
    <InsetRow
      label={label}
      subtitle={subtitle}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      chevron
    />
  );
}

/** A display-only row with a right-aligned value. */
export function ValueRow({
  label,
  subtitle,
  value,
  icon,
}: Omit<InsetRowProps, 'trailing' | 'onClick' | 'chevron'> & { value: ReactNode }) {
  return (
    <InsetRow
      label={label}
      subtitle={subtitle}
      icon={icon}
      trailing={
        <span className="text-base font-medium text-[var(--label)] tnum">{value}</span>
      }
    />
  );
}

/** A row holding a Switch on the right. The switch itself is interactive. */
export function SwitchRow({
  label,
  subtitle,
  icon,
  children,
}: Omit<InsetRowProps, 'trailing' | 'onClick' | 'chevron' | 'label'> & {
  label: string;
  /** The Switch element (or any interactive node) to render on the right. */
  children: ReactNode;
}) {
  return (
    <InsetRow label={label} subtitle={subtitle} icon={icon} trailing={children} />
  );
}

export {
  InsetList as ClearInsetList,
  InsetRow as ClearInsetRow,
  ChevronRow as ClearChevronRow,
  ValueRow as ClearValueRow,
  SwitchRow as ClearSwitchRow,
};
export default InsetList;

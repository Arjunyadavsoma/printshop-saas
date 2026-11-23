'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Clear design system — radio row + group.
 *
 * A full-width selectable row for mutually-exclusive choices that need more
 * room than a segmented control: delivery method (Pickup / Doorstep /
 * Courier), paper size (A4 / A3 / Legal), binding type. Each row shows a
 * label, an optional subtitle (one line of context), and an optional
 * right-aligned value (typically a price or ETA).
 *
 * Spec:
 *  - radio circle: 22px, hairline border, transparent fill when unselected
 *  - selected: a 7px solid accent dot centred inside the 22px circle
 *    (reads as an "accent ring" — the border stays, the dot fills the centre)
 *  - row: min-height 56px, full width, surface background, 16px horizontal padding
 *  - label: 16px / 500 weight, label colour
 *  - subtitle: 13px, label-2 colour, one line
 *  - value (right): 15px / 600 weight, label colour, tabular-nums (for prices)
 *
 * Keyboard follows the WAI-ARIA radiogroup pattern: Tab moves focus onto the
 * *selected* row (roving tabindex); Arrow Up/Down, Home, and End move and
 * select together. Space selects the focused row.
 */

export interface RadioOption {
  /** Stable value emitted when this row is selected. */
  value: string;
  /** Main label. */
  label: string;
  /** Optional subtitle / context line. */
  subtitle?: string;
  /** Optional right-aligned value (e.g. "₹48", "2 hours"). */
  valueLabel?: string;
  /** Optional leading icon (Lucide). */
  icon?: ReactNode;
  /** Disable this individual row. */
  disabled?: boolean;
}

export interface RadioRowGroupProps {
  /** The options to render as rows. */
  options: RadioOption[];
  /** The currently selected value. */
  value: string;
  /** Fires with the newly selected value. */
  onChange: (value: string) => void;
  /** ARIA label for the group (e.g. "Delivery method"). */
  ariaLabel: string;
  /** Optional className for the group wrapper. */
  className?: string;
}

export function RadioRowGroup({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: RadioRowGroupProps) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  if (options.length === 0) return null;

  const selectedIndex = options.findIndex((o) => o.value === value && !o.disabled);
  // Roving tabindex: the selected (enabled) row is the tab stop. If none
  // match, the first enabled row is the tab stop so the group is reachable.
  const firstEnabled = options.findIndex((o) => !o.disabled);
  const tabStopIndex = selectedIndex === -1 ? Math.max(0, firstEnabled) : selectedIndex;

  const move = (target: number) => {
    if (options.length === 0) return;
    // Skip disabled rows when navigating.
    let next = ((target % options.length) + options.length) % options.length;
    for (let i = 0; i < options.length; i++) {
      if (!options[next].disabled) break;
      next = (next + 1) % options.length;
    }
    if (options[next].disabled) return;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        move(i + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        move(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(options.length - 1);
        break;
      // Space / Enter: native for role="radio" click — no need to intercept,
      // but we handle Enter explicitly because <div role="radio"> does not
      // fire click on Enter natively.
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!options[i].disabled) onChange(options[i].value);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={className}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <div
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={selected}
            aria-disabled={opt.disabled || undefined}
            tabIndex={opt.disabled ? -1 : i === tabStopIndex ? 0 : -1}
            onClick={() => !opt.disabled && onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              'flex items-center gap-3 w-full',
              'min-h-[56px] px-4 py-2',
              'bg-[var(--surface)]',
              'transition-colors duration-150 ease-out',
              'cursor-pointer select-none',
              opt.disabled ? 'opacity-40 cursor-not-allowed' : '',
              'focus:outline-none',
            ].join(' ')}
          >
            {/* Radio circle — 22px, hairline border, 7px accent dot when selected. */}
            <span
              aria-hidden="true"
              className={[
                'relative shrink-0 inline-flex items-center justify-center',
                'size-[22px] rounded-full border-2',
                'transition-colors duration-150',
                selected ? 'border-[var(--accent)]' : 'border-[var(--hairline)]',
              ].join(' ')}
            >
              {selected && <span className="size-[7px] rounded-full bg-[var(--accent)]" />}
            </span>

            {/* Optional leading icon */}
            {opt.icon && (
              <span className="shrink-0 inline-flex text-[var(--label-2)]" aria-hidden="true">
                {opt.icon}
              </span>
            )}

            {/* Label + subtitle */}
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-base font-medium text-[var(--label)] leading-snug truncate">
                {opt.label}
              </span>
              {opt.subtitle && (
                <span className="text-[13px] text-[var(--label-2)] leading-snug truncate">
                  {opt.subtitle}
                </span>
              )}
            </div>

            {/* Right-aligned value (price / ETA) */}
            {opt.valueLabel && (
              <span className="shrink-0 text-[15px] font-semibold text-[var(--label)] tnum">
                {opt.valueLabel}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { RadioRowGroup as ClearRadioRowGroup };
export default RadioRowGroup;

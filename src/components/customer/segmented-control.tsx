'use client';

import { useRef, type KeyboardEvent } from 'react';

/**
 * SegmentedControl — a compact, mutually-exclusive option switcher.
 *
 * For two-or-three-way choices that are too tight to justify full
 * buttons: "One-sided / Double-sided", "Portrait / Landscape",
 * "Pickup / Delivery". The active segment lifts off the track
 * (surface bg + ink text + bar shadow); inactive ones sit flat in
 * muted text against the paper-coloured trough.
 *
 * Keyboard follows the WAI-ARIA radiogroup pattern: Tab moves focus
 * onto the *selected* segment (roving tabindex — only one is in the
 * tab order at a time); Arrow Left/Right, Home, and End move and
 * select together. All segments meet the 48px touch target minimum
 * (WCAG 2.5.5).
 */

interface SegmentedOption {
  /** Stable value emitted to `onChange`. */
  value: string;
  /** Visible label. */
  label: string;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  /** Currently selected value. If none match, the first option is the tab stop. */
  value: string;
  onChange: (value: string) => void;
  /** ARIA label describing what the control switches (e.g. "Page sides"). */
  ariaLabel?: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = options.findIndex((o) => o.value === value);
  // Roving tabindex: the selected option is the tab stop. If nothing
  // matches (parent passed an unrecognised value), the first option
  // becomes the tab stop so the control is always reachable.
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const move = (target: number) => {
    if (options.length === 0) return;
    const wrapped = ((target % options.length) + options.length) % options.length;
    onChange(options[wrapped].value);
    refs.current[wrapped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(i + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
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
      // Enter / Space are handled natively by <button>; no need to intercept.
    }
  };

  if (options.length === 0) return null;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={[
        'flex bg-[var(--color-paper)]',
        'border border-[var(--color-border-ink)]',
        'rounded-[var(--radius-default)]',
        'p-1 gap-1',
        className,
      ].join(' ')}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === tabStopIndex ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              'flex-1 min-h-[48px] px-3',
              'flex items-center justify-center',
              'text-sm font-medium text-center',
              'rounded-[var(--radius-tight)]',
              'transition-colors duration-150',
              'disabled:opacity-50 disabled:pointer-events-none',
              selected
                ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-bar)]'
                : 'bg-transparent text-[var(--color-muted)]',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;

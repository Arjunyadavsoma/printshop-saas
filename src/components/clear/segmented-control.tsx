'use client';

import { useRef, type KeyboardEvent } from 'react';

/**
 * Clear design system — segmented control.
 *
 * A compact, mutually-exclusive option switcher for two-or-three-way
 * choices that are too tight to justify full buttons: "One-sided /
 * Double-sided", "Portrait / Landscape", "Pickup / Delivery".
 *
 * Spec:
 *  - height 44px (min-h-[44px]) — meets the compact touch target
 *  - track: var(--track) grey trough, radius 12 (--radius-segment-track)
 *  - active segment: white surface indicator that slides between positions,
 *    radius 10 (--radius-segment-inner), soft shadow lifting it off the track
 *  - inactive segments: label-2 muted text, transparent bg
 *  - sliding indicator: absolutely positioned, translate-x based on selected
 *    index, transitions over 200ms ease-out
 *
 * Keyboard follows the WAI-ARIA radiogroup pattern: Tab moves focus onto
 * the *selected* segment (roving tabindex — only one is in the tab order
 * at a time); Arrow Left/Right, Home, and End move and select together.
 */

export interface SegmentedOption {
  /** Stable value emitted to `onChange`. */
  value: string;
  /** Visible label. */
  label: string;
}

export interface SegmentedControlProps {
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
  // matches, the first option becomes the tab stop.
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
    }
  };

  if (options.length === 0) return null;

  // The sliding indicator's left position + width: each segment is an equal
  // fraction of the track, so the indicator sits at (100% / n) * index and
  // spans (100% / n). We use percentage-based inline styles so the layout
  // adapts to any number of options without JS measurement.
  const segmentWidth = 100 / options.length;
  const indicatorLeft = selectedIndex === -1 ? 0 : segmentWidth * selectedIndex;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={[
        'relative flex bg-[var(--track)]',
        'rounded-[var(--radius-segment-track)]',
        'p-1 gap-0',
        className,
      ].join(' ')}
    >
      {/* Sliding indicator — sits behind the buttons, slides between positions. */}
      {selectedIndex !== -1 && (
        <span
          aria-hidden="true"
          className={[
            'absolute top-1 bottom-1',
            'bg-[var(--surface)] rounded-[var(--radius-segment-inner)]',
            'shadow-[0_1px_2px_rgb(16_24_40_/_0.08),0_1px_1px_rgb(16_24_40_/_0.04)]',
            'transition-[left] duration-200 ease-out',
          ].join(' ')}
          style={{
            left: `calc(${indicatorLeft}% + 4px)`,
            width: `calc(${segmentWidth}% - 8px)`,
          }}
        />
      )}

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
              'relative z-10 flex-1 min-h-[44px] px-3',
              'flex items-center justify-center',
              'text-sm font-medium text-center',
              'transition-colors duration-150',
              'disabled:opacity-40 disabled:pointer-events-none',
              'focus:outline-none',
              selected ? 'text-[var(--label)]' : 'text-[var(--label-2)]',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl as ClearSegmentedControl };
export default SegmentedControl;

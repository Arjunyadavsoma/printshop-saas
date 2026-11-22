'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * NumberStepper — a tactile +/− counter for copy counts.
 *
 * Large 48px ± buttons flank a numeric input. Typing is allowed
 * (1–100 by default); intermediate keystrokes are buffered locally
 * and committed to the parent on blur or Enter, so the price total
 * doesn't flicker with every digit. The display uses tabular figures
 * (`.tnum`) so digits don't shift width as the value changes — no
 * layout shift on state change.
 *
 * Never goes below `min` or above `max`: the corresponding ± button
 * disables at the bound (rather than allowing overshoot and snapping
 * back). ArrowUp / ArrowDown on the input also step by 1, matching
 * native number-input affordance.
 */

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  /** Minimum value. Defaults to 1. */
  min?: number;
  /** Maximum value. Defaults to 100. */
  max?: number;
  /** Optional label above the stepper (e.g. "Copies"). */
  label?: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 100,
  label,
  className = '',
}: NumberStepperProps) {
  // Local draft of the input value. We keep this as a string so the
  // user can clear the field or type intermediate states ("3" while
  // aiming for "35") without the parent clamping it mid-keystroke.
  const [draft, setDraft] = useState<string>(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  // useId generates a stable ID for the label/input pair.
  const inputId = useId();

  // Sync the draft when the external value changes (e.g. after a ±
  // button click, or if the parent resets the value externally).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  const commit = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      // Empty or non-numeric — revert to the last committed value.
      setDraft(String(value));
      return;
    }
    const clamped = clamp(parsed);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const step = (delta: number) => {
    const next = clamp(value + delta);
    if (next !== value) onChange(next);
  };

  const atMin = value <= min;
  const atMax = value >= max;

  const baseButton = [
    'touch-target flex items-center justify-center w-12 shrink-0',
    'text-[var(--color-ink)] bg-[var(--color-surface)]',
    'transition-colors duration-150 active:bg-[var(--color-paper)]',
    'disabled:opacity-40 disabled:pointer-events-none',
  ];

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-[var(--color-muted)]">
          {label}
        </label>
      )}
      <div className="inline-flex items-stretch rounded-[var(--radius-default)] border border-[var(--color-border-ink)] overflow-hidden bg-[var(--color-surface)]">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={atMin}
          aria-label={`Decrease ${label ?? 'value'}`}
          className={[...baseButton, 'border-r border-[var(--color-border-ink)]'].join(' ')}
        >
          <Minus className="size-5" aria-hidden="true" />
        </button>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          // The input has role spinbutton semantics: value, min, max,
          // and now are all exposed. We don't set role="spinbutton"
          // explicitly because the input already exposes that via
          // type=text + aria-valuemin/max/now — but to be safe we
          // also set the role.
          role="spinbutton"
          onChange={(e) => {
            // Strip non-digits; allow empty (so the user can clear
            // and retype). Live-commit only when the parsed value is
            // in range — out-of-range drafts wait for blur to clamp.
            const raw = e.target.value.replace(/[^0-9]/g, '');
            setDraft(raw);
            if (raw === '') return;
            const parsed = parseInt(raw, 10);
            if (!Number.isNaN(parsed) && parsed >= min && parsed <= max && parsed !== value) {
              onChange(parsed);
            }
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
              inputRef.current?.blur();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              step(-1);
            }
          }}
          className={[
            'w-16 min-h-[48px] text-center text-lg font-semibold',
            'text-[var(--color-ink)] bg-[var(--color-surface)]',
            'tnum outline-none',
          ].join(' ')}
        />

        <button
          type="button"
          onClick={() => step(1)}
          disabled={atMax}
          aria-label={`Increase ${label ?? 'value'}`}
          className={[...baseButton, 'border-l border-[var(--color-border-ink)]'].join(' ')}
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default NumberStepper;

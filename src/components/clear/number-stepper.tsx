'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * Clear design system — number stepper.
 *
 * A tactile +/− counter for copy counts. 48px ± buttons flank a numeric
 * input. Typing is allowed (1–100 by default); intermediate keystrokes
 * are buffered locally and committed to the parent on blur or Enter, so
 * the price total doesn't flicker with every digit. Tabular figures so
 * digits don't shift width as the value changes.
 *
 * The ± buttons are 48px-square with rounded-full shape, surface fill +
 * hairline border. The input sits in the middle with a fill background
 * that visually connects the two buttons into a single pill-shaped
 * control. Bound buttons (at min / at max) disable rather than allowing
 * overshoot.
 */

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
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
  const [draft, setDraft] = useState<string>(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  const commit = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
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

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-[var(--label-2)]">
          {label}
        </label>
      )}
      <div className="inline-flex items-stretch rounded-full border border-[var(--hairline)] overflow-hidden bg-[var(--surface)]">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={atMin}
          aria-label={`Decrease ${label ?? 'value'}`}
          className={[
            'inline-flex items-center justify-center w-12 shrink-0',
            'text-[var(--label)] bg-[var(--surface)]',
            'transition-colors duration-150 hover:bg-[var(--fill)] active:bg-[var(--fill)]',
            'disabled:opacity-40 disabled:pointer-events-none',
            'border-r border-[var(--hairline)]',
          ].join(' ')}
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
          role="spinbutton"
          onChange={(e) => {
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
          className="w-16 min-h-[48px] text-center text-lg font-semibold text-[var(--label)] bg-[var(--fill)] tnum outline-none"
        />

        <button
          type="button"
          onClick={() => step(1)}
          disabled={atMax}
          aria-label={`Increase ${label ?? 'value'}`}
          className={[
            'inline-flex items-center justify-center w-12 shrink-0',
            'text-[var(--label)] bg-[var(--surface)]',
            'transition-colors duration-150 hover:bg-[var(--fill)] active:bg-[var(--fill)]',
            'disabled:opacity-40 disabled:pointer-events-none',
            'border-l border-[var(--hairline)]',
          ].join(' ')}
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export { NumberStepper as ClearNumberStepper };
export default NumberStepper;

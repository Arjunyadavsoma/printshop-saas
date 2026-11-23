'use client';

import { forwardRef, useId } from 'react';
import { Check } from 'lucide-react';

/**
 * Clear design system — Indian mobile number input.
 *
 * A specialised Input that:
 *   • Forces `type="tel"`, `inputMode="tel"`, `autoComplete="tel"` so the
 *     numeric keypad shows and autofill works.
 *   • Shows a non-editable "+91" prefix (India country code) in label-2 text.
 *   • Strips every non-digit as the customer types — `onChange` always
 *     fires with digits only, capped at 10.
 *   • Validates inline: a muted "Enter all 10 digits" nudge until the
 *     field is complete, then a green checkmark once the number is a
 *     valid Indian mobile (10 digits, starts with 6/7/8/9).
 *
 * If the customer enters 10 digits that don't start with 6-9, an error
 * "Mobile numbers start with 6, 7, 8 or 9" appears. A parent-supplied
 * `error` (e.g. "This number is already registered") overrides the inline
 * check and suppresses the green tick.
 *
 * The fill background + 12px radius match the base Input; the +91 prefix
 * sits in a non-editable strip on the left, separated from the digit field
 * by the focus-within ring rather than a hard divider.
 */

/** Keep only digits, cap at 10. */
function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 10);
}

/** A valid Indian mobile: 10 digits, first digit 6-9. */
function isValidIndianMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

export interface PhoneInputProps {
  /** Visible label. Defaults to "Mobile number". */
  label?: string;
  /** id — paired with the label's htmlFor. If omitted, a stable useId is used. */
  id?: string;
  /** Current digits-only value. */
  value: string;
  /** Fires with digits-only value (max 10). */
  onChange: (value: string) => void;
  /** Parent-supplied error. Overrides inline validation and hides the tick. */
  error?: string;
  /** Marks the field required. Defaults to true. */
  required?: boolean;
  /** Optional className for the wrapper. */
  className?: string;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { label = 'Mobile number', id, value, onChange, error, required = true, className = '' },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const digits = normalisePhone(value);
  const isComplete = digits.length === 10;
  const isValid = isValidIndianMobile(digits);

  // Decide what (if anything) to show under the field.
  // A parent `error` always wins; otherwise we compute the inline state.
  let inlineHint: string | null = null;
  let inlineError: string | null = null;
  if (error) {
    inlineError = error;
  } else if (digits.length > 0 && !isComplete) {
    inlineHint = 'Enter all 10 digits';
  } else if (isComplete && !isValid) {
    inlineError = 'Mobile numbers start with 6, 7, 8 or 9';
  }

  const describedBy = [inlineHint ? hintId : null, inlineError ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  // Show the green check only when there is no error and the number is valid.
  const showCheck = !error && isComplete && isValid;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <label htmlFor={inputId} className="text-[13px] font-medium text-[var(--label-2)]">
        {label}
        {required && (
          <span className="ml-1 font-normal text-[var(--label-3)]">(required)</span>
        )}
      </label>

      <div
        className={[
          'flex items-stretch min-h-[48px] w-full',
          'rounded-[var(--radius-input)] border bg-[var(--fill)]',
          'transition-colors duration-150',
          'focus-within:border-[var(--accent)]',
          inlineError ? 'border-[var(--danger)]' : 'border-transparent',
        ].join(' ')}
      >
        {/* Non-editable +91 country code prefix */}
        <span
          className="flex items-center px-3 select-none text-base text-[var(--label-2)] tnum"
          aria-hidden="true"
        >
          +91
        </span>

        <input
          ref={ref}
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={digits}
          onChange={(e) => onChange(normalisePhone(e.target.value))}
          required={required}
          maxLength={10}
          placeholder="98765 43210"
          aria-invalid={inlineError ? true : undefined}
          aria-describedby={describedBy}
          className={[
            'flex-1 min-w-0 px-1 py-3 text-base bg-transparent',
            'text-[var(--label)] placeholder:text-[var(--label-3)]',
            'focus:outline-none tnum',
          ].join(' ')}
        />

        {/* Green check — appears once the number is complete & valid */}
        {showCheck && (
          <span
            className="flex items-center pr-3.5 text-[var(--success)]"
            aria-label="Valid number"
          >
            <Check className="size-5" aria-hidden="true" />
          </span>
        )}
      </div>

      {inlineHint && (
        <p id={hintId} className="text-[13px] text-[var(--label-3)]">
          {inlineHint}
        </p>
      )}
      {inlineError && (
        <p id={errorId} className="text-[13px] text-[var(--danger-text)]" role="alert">
          {inlineError}
        </p>
      )}
    </div>
  );
});

export { PhoneInput as ClearPhoneInput };
export default PhoneInput;

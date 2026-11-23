'use client';

import { useId, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Check, AlertCircle } from 'lucide-react';

/**
 * Clear design system — UPI Transaction Reference (UTR / RRN) input.
 *
 * After a customer pays via UPI, they receive a 12-digit reference number
 * (the UTR / RRN) in their payment app. This component captures it with
 * the affordances that make 12-digit entry bearable on a phone:
 *
 *  - **Numeric keypad** (`inputMode="numeric"`, `pattern="[0-9 ]*"`) so the
 *    keyboard shows digits, not letters.
 *  - **Auto-formatting** as the user types/pastes into groups of 4
 *    ("1234 5678 9012") — the same shape every bank app shows, so the user
 *    can eyeball-verify against their receipt.
 *  - **Paste detection**: if a 12-digit string (optionally with separators)
 *    is pasted, it's normalized and reformatted in one shot.
 *  - **Inline countdown**: "Enter all 12 digits — N more" while incomplete,
 *    then a green check + "Looks right. Submit when ready." when complete.
 *
 * The `<input>` is `text-base` (16px) explicitly to prevent iOS Safari's
 * zoom-on-focus behaviour. The fill background + 12px radius match the base
 * Input. The visible `<label>` is paired via `htmlFor`.
 *
 * The component is **controlled**: the parent owns `value` and `onChange`.
 * The formatted value (with spaces) is what's stored — the parent strips
 * spaces before sending to the API.
 */

/** Total expected digit count for a UPI UTR. */
const UTR_LENGTH = 12;

export interface UTRInputProps {
  /** The current value, possibly with spaces (e.g. "1234 5678 9012"). */
  value: string;
  /** Fired with the formatted value on every change. */
  onChange: (value: string) => void;
  /** Fired on Enter / form submit when the field is complete. */
  onSubmit?: () => void;
  /** Optional server-side error (e.g. "UTR not found for this order"). */
  error?: string;
  /** Optional id override. If omitted a stable useId is used. */
  id?: string;
  /** Optional className for the wrapper. */
  className?: string;
}

/** Strip everything except digits. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Format a digit string into "XXXX XXXX XXXX" groups of 4. */
function formatUtr(digits: string): string {
  const trimmed = digits.slice(0, UTR_LENGTH);
  return trimmed.match(/.{1,4}/g)?.join(' ') ?? '';
}

export function UTRInput({ value, onChange, onSubmit, error, id, className = '' }: UTRInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const digitCount = digitsOnly(value).length;
  const isComplete = digitCount === UTR_LENGTH;
  const remaining = Math.max(0, UTR_LENGTH - digitCount);

  const showCountdown = !isComplete && digitCount > 0 && !error;
  const showEmptyHint = digitCount === 0 && !error;

  const handleChange = (next: string) => {
    // Always re-format on change so the user never sees raw ungrouped digits.
    onChange(formatUtr(digitsOnly(next)));
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    const digits = digitsOnly(pasted);
    if (digits.length >= UTR_LENGTH) {
      e.preventDefault();
      onChange(formatUtr(digits));
    }
    // Shorter pastes fall through to the default handler + handleChange.
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isComplete && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Compose aria-describedby for both hint (status) and error.
  const describedBy = [showCountdown || showEmptyHint || isComplete ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <label htmlFor={inputId} className="text-[13px] font-medium text-[var(--label-2)]">
        Enter UTR (12 digits)
      </label>

      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        pattern="[0-9 ]*"
        maxLength={UTR_LENGTH + 2 /* 12 digits + 2 separator spaces */}
        placeholder="1234 5678 9012"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={[
          'min-h-[48px] w-full px-3.5 py-3',
          'text-base tnum tracking-wide',
          'rounded-[var(--radius-input)] border bg-[var(--fill)]',
          'text-[var(--label)] placeholder:text-[var(--label-3)]',
          'transition-colors duration-150',
          'focus:outline-none',
          error ? 'border-[var(--danger)]' : 'border-transparent',
        ].join(' ')}
      />

      {/* Status row — error wins, then success, then countdown, then empty hint. */}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-[13px] text-[var(--danger-text)]"
        >
          <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : isComplete ? (
        <p
          id={hintId}
          role="status"
          className="flex items-center gap-1.5 text-[13px] text-[var(--success-text)]"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          <span>Looks right. Submit when ready.</span>
        </p>
      ) : showCountdown ? (
        <p
          id={hintId}
          role="status"
          aria-live="polite"
          className="text-[13px] text-[var(--label-3)] tnum"
        >
          Enter all 12 digits — {remaining} more
        </p>
      ) : showEmptyHint ? (
        <p id={hintId} className="text-[13px] text-[var(--label-3)]">
          Find the 12-digit reference in your UPI app&rsquo;s payment receipt.
        </p>
      ) : (
        <p id={hintId} className="text-[13px] text-transparent" aria-hidden="true">
          placeholder
        </p>
      )}
    </div>
  );
}

export { UTRInput as ClearUTRInput };
export default UTRInput;

'use client';

import { useId, type ClipboardEvent, type FormEvent } from 'react';
import { Check, AlertCircle } from 'lucide-react';

/**
 * UTRInput — the 12-digit UPI Transaction Reference entry field.
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
 *    The customer never has to guess whether they're done.
 *
 * The `<input>` is `text-base` (16px) explicitly to prevent iOS Safari's
 * zoom-on-focus behaviour (Safari zooms inputs < 16px).
 *
 * The visible `<label>` is paired via `htmlFor` — never a placeholder-only
 * label, which is a common accessibility failure on mobile forms.
 *
 * The component is **controlled**: the parent owns `value` and `onChange`.
 * The formatted value (with spaces) is what's stored — the parent strips
 * spaces before sending to the API.
 */

/** Total expected digit count for a UPI UTR. */
const UTR_LENGTH = 12;

interface UTRInputProps {
  /** The current value, possibly with spaces (e.g. "1234 5678 9012"). */
  value: string;
  /** Fired with the formatted value on every change. */
  onChange: (value: string) => void;
  /** Fired on Enter / form submit when the field is complete. */
  onSubmit?: () => void;
  /** Optional server-side error (e.g. "UTR not found for this order"). */
  error?: string;
}

/**
 * Strip everything except digits. Used to count real digits regardless of
 * the spaces the user (or our formatter) inserted.
 */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Format a digit string into "XXXX XXXX XXXX" groups of 4.
 * Stops at 12 digits; extra digits are dropped (UTRs are exactly 12).
 */
function formatUtr(digits: string): string {
  const trimmed = digits.slice(0, UTR_LENGTH);
  // Group every 4 digits, join with a single space. Trailing group may be
  // shorter while the user is mid-entry — that's expected and useful
  // (they see "1234 5678 90" and know they need 2 more).
  return trimmed.match(/.{1,4}/g)?.join(' ') ?? '';
}

export function UTRInput({ value, onChange, onSubmit, error }: UTRInputProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const digitCount = digitsOnly(value).length;
  const isComplete = digitCount === UTR_LENGTH;
  const remaining = Math.max(0, UTR_LENGTH - digitCount);

  // Show the live countdown only while the user is mid-entry and there's no
  // blocking server error. Once complete, swap to the success affordance.
  const showCountdown = !isComplete && digitCount > 0 && !error;
  // Show the empty prompt only when truly empty (no digits yet, no error).
  const showEmptyHint = digitCount === 0 && !error;

  const handleChange = (next: string) => {
    // Always re-format on change so the user never sees raw ungrouped digits
    // (except transiently while typing the 5th digit of a group, which is
    // fine — the formatter re-groups on the next keystroke).
    onChange(formatUtr(digitsOnly(next)));
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    const digits = digitsOnly(pasted);
    if (digits.length >= UTR_LENGTH) {
      // A full (or over-long) UTR was pasted: normalize + format in place,
      // then prevent the default paste so the browser doesn't insert raw
      // text and trigger a double-change.
      e.preventDefault();
      onChange(formatUtr(digits));
    }
    // Shorter pastes fall through to the default handler + handleChange,
    // which still formats whatever digits came in.
  };

  const handleKeyDown = (e: FormEvent<HTMLInputElement>) => {
    // Native onSubmit of <form>; we only forward when complete to avoid
    // letting Enter fire a half-typed submit.
    const nativeEvent = e as unknown as React.KeyboardEvent<HTMLInputElement>;
    if (nativeEvent.key === 'Enter' && isComplete && onSubmit) {
      onSubmit();
    }
  };

  // aria-describedby wires up BOTH the hint (status) and the error so screen
  // readers announce validation state alongside the field label.
  const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-[var(--color-ink)]"
      >
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
          'touch-target w-full min-h-[48px] px-4',
          'text-base tnum tabular-nums tracking-wide',
          'rounded-[var(--radius-default)]',
          'bg-[var(--color-surface)] text-[var(--color-ink)]',
          'border border-[var(--color-border-ink)]',
          'focus:border-[var(--color-cyan-ink)] focus:outline-none',
          'transition-colors',
          error ? 'border-[var(--color-error)]' : '',
        ].join(' ')}
      />

      {/* ── Status row ── */}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-sm text-[var(--color-error)]"
        >
          <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : isComplete ? (
        <p
          id={hintId}
          role="status"
          className="flex items-center gap-1.5 text-sm text-[var(--color-success)]"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          <span>Looks right. Submit when ready.</span>
        </p>
      ) : showCountdown ? (
        <p
          id={hintId}
          role="status"
          aria-live="polite"
          className="text-sm text-[var(--color-muted)] tnum"
        >
          Enter all 12 digits — {remaining} more
        </p>
      ) : showEmptyHint ? (
        <p id={hintId} className="text-sm text-[var(--color-muted)]">
          Find the 12-digit reference in your UPI app's payment receipt.
        </p>
      ) : (
        /* Reserve the hint slot so layout doesn't jump when state changes. */
        <p id={hintId} className="text-sm text-transparent" aria-hidden="true">
          placeholder
        </p>
      )}
    </div>
  );
}

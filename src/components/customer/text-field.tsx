'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

/**
 * TextField — the base text input for the customer flow.
 *
 * Always renders a visible `<label>` paired to the input via `htmlFor`/`id`
 * (never a placeholder-as-label). 16px body text prevents iOS auto-zoom on
 * focus. 48px minimum height for the thumb. Focus paints a cyan-ink
 * border + cyan-ink ring (the C in CMYK). Errors paint an error border and
 * a text-level message linked via `aria-describedby`.
 *
 * Required fields are marked with a muted "(required)" after the label —
 * never a red asterisk, which reads as alarming and is invisible to
 * screen-reader users who don't hear colour.
 */

type TextInputMode = InputHTMLAttributes<HTMLInputElement>['inputMode'];

interface TextFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'type' | 'inputMode' | 'autoComplete'
  > {
  /** Visible label text. */
  label: string;
  /** id — paired with the label's htmlFor. Must be unique on the page. */
  id: string;
  /** Controlled value. */
  value: string;
  /** Fires with the new string value (not the event). */
  onChange: (value: string) => void;
  /** Inline error message. Renders the input in the error state + a linked hint. */
  error?: string;
  /** Non-error helper text shown under the label when there is no error. */
  hint?: string;
  /** Placeholder shown inside the input when empty. */
  placeholder?: string;
  /** Marks the field required — appends "(required)" to the label. */
  required?: boolean;
  /** Input type. Defaults to "text". */
  type?: string;
  /** inputMode hint for the on-screen keyboard. */
  inputMode?: TextInputMode;
  /** autocomplete token. */
  autoComplete?: string;
  /** Max character count. */
  maxLength?: number;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    id,
    value,
    onChange,
    error,
    hint,
    placeholder,
    required = false,
    type = 'text',
    inputMode,
    autoComplete,
    maxLength,
    className = '',
    ...rest
  },
  ref,
) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // Compose the describedby list so the input points at whichever hint(s) apply.
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-ink)]">
        {label}
        {required && (
          <span className="ml-1 font-normal text-[var(--color-muted)]">(required)</span>
        )}
      </label>

      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          // 16px text → no iOS zoom; 48px min height → thumb target.
          'min-h-[48px] w-full px-3.5 py-3 text-base',
          'rounded-[var(--radius-default)] border bg-[var(--color-surface)]',
          'text-[var(--color-ink)] placeholder:text-[var(--color-muted)]',
          // Focus: cyan-ink border + cyan-ink ring (the C in CMYK).
          'focus:outline-none focus:border-[var(--color-cyan-ink)] focus:ring-2 focus:ring-[rgb(0_111_166_/_0.3)]',
          'transition-colors duration-150',
          error
            ? 'border-[var(--color-error)]'
            : 'border-[var(--color-border-ink)]',
        ].join(' ')}
        {...rest}
      />

      {/* Hint shows only when there's no error; error wins. */}
      {hint && !error && (
        <p id={hintId} className="text-xs text-[var(--color-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-[var(--color-error)]">
          {error}
        </p>
      )}
    </div>
  );
});

TextField.displayName = 'TextField';

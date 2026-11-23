'use client';

import { forwardRef, useId, type InputHTMLAttributes } from 'react';

/**
 * Clear design system — text input.
 *
 * Height 48px, radius 12px (--radius-input), fill background (--fill #F2F3F7),
 * 16px text (prevents iOS Safari zoom-on-focus). A visible `<label>` sits
 * above the field, paired via htmlFor/id. Error + hint messages are linked
 * to the input via `aria-describedby` so screen readers announce validation
 * state alongside the field label.
 *
 * Focus styling is handled globally by `*:focus-visible` in globals.css,
 * which paints a 2px accent ring with 2px offset. We do NOT add a focus
 * border here — the ring is the single visible focus affordance, applied
 * consistently across the whole app.
 *
 * Required fields are marked with a muted "(required)" suffix on the label
 * — never a red asterisk, which reads as alarming and is invisible to
 * screen-reader users who don't hear colour.
 */

type TextInputMode = InputHTMLAttributes<HTMLInputElement>['inputMode'];

export interface ClearInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'type' | 'inputMode' | 'autoComplete'
  > {
  /** Visible label text, rendered above the input. Required. */
  label: string;
  /** id — paired with the label's htmlFor. If omitted, a stable useId is used. */
  id?: string;
  /** Controlled value. */
  value: string;
  /** Fires with the new string value (not the event). */
  onChange: (value: string) => void;
  /** Inline error message. Renders the input in the error state + a linked hint. */
  error?: string;
  /** Non-error helper text shown under the input when there is no error. */
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

export const Input = forwardRef<HTMLInputElement, ClearInputProps>(function Input(
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
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  // Compose the describedby list so the input points at whichever hint(s) apply.
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <label
        htmlFor={inputId}
        className="text-[13px] font-medium text-[var(--label-2)]"
      >
        {label}
        {required && (
          <span className="ml-1 font-normal text-[var(--label-3)]">(required)</span>
        )}
      </label>

      <input
        ref={ref}
        id={inputId}
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
          // 48px height + 16px text → no iOS zoom + thumb-friendly target.
          // radius 12 (--radius-input), fill bg, label text colour.
          'min-h-[48px] w-full px-3.5 py-3 text-base',
          'rounded-[var(--radius-input)] border bg-[var(--fill)]',
          'text-[var(--label)] placeholder:text-[var(--label-3)]',
          'transition-colors duration-150',
          'focus:outline-none',
          // Error paints a danger border; otherwise transparent border (fill carries the shape).
          error ? 'border-[var(--danger)]' : 'border-transparent',
        ].join(' ')}
        {...rest}
      />

      {/* Hint shows only when there's no error; error wins. */}
      {hint && !error && (
        <p id={hintId} className="text-[13px] text-[var(--label-3)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[13px] text-[var(--danger-text)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

export { Input as ClearInput };
export default Input;

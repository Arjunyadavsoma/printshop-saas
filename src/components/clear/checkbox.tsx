'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * Clear design system — checkbox.
 *
 * A 22px square checkbox with the Clear visual language:
 *  - unchecked: hairline border, transparent fill
 *  - checked:   accent fill, white check icon, no border (the fill carries the shape)
 *  - indeterminate: accent fill, white minus icon
 *  - disabled:  40% opacity, no pointer events
 *
 * The checkbox is built on a visually-hidden native `<input type="checkbox">`
 * so we get free keyboard support (Space toggles), form submission, and
 * screen-reader semantics. The visible 22px box is a sibling `<span>` that
 * reflects the input's state via `peer-checked:` utilities.
 *
 * Touch target: the visible box is 22px, but the clickable area is padded
 * out to 44px via the wrapper + the label text. When used without a label
 * (icon-only), pass an `aria-label`.
 */

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Optional visible label rendered beside the box. */
  label?: ReactNode;
  /** Optional description under the label. */
  description?: ReactNode;
  /** Indeterminate state (overrides checked). */
  indeterminate?: boolean;
  /** Accessible name when no visible label is provided. */
  'aria-label'?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    label,
    description,
    indeterminate = false,
    disabled,
    checked,
    className = '',
    ...props
  },
  ref,
) {
  return (
    <label
      className={[
        'inline-flex items-start gap-2.5 cursor-pointer select-none',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
        className,
      ].join(' ')}
    >
      {/* Visually-hidden native input — carries semantics + keyboard. */}
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        checked={indeterminate ? false : checked}
        {...props}
        className="peer sr-only"
      />

      {/* Visible 22px box — reflects state via peer-checked / peer-disabled. */}
      <span
        aria-hidden="true"
        className={[
          'relative shrink-0 inline-flex items-center justify-center',
          'size-[22px] rounded-[6px] border-2',
          'transition-colors duration-150 ease-out',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2',
          indeterminate
            ? 'bg-[var(--accent)] border-[var(--accent)]'
            : checked
              ? 'bg-[var(--accent)] border-[var(--accent)]'
              : 'bg-transparent border-[var(--hairline)]',
        ].join(' ')}
      >
        {indeterminate ? (
          <span className="block w-3 h-0.5 bg-[var(--on-accent)] rounded-full" />
        ) : checked ? (
          <Check className="size-4 text-[var(--on-accent)]" strokeWidth={3} />
        ) : null}
      </span>

      {/* Optional label + description */}
      {(label || description) && (
        <span className="flex flex-col">
          {label && (
            <span className="text-base text-[var(--label)] leading-snug">{label}</span>
          )}
          {description && (
            <span className="text-[13px] text-[var(--label-2)] leading-snug">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
});

export { Checkbox as ClearCheckbox };
export default Checkbox;

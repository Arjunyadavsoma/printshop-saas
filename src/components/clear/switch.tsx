'use client';

import { type ReactNode } from 'react';

/**
 * Clear design system — switch (toggle).
 *
 * A 51x31 pill-shaped toggle. The track is the grey track colour when off
 * and the accent colour when on; the 27px circular thumb slides from left
 * to right. Keyboard-operable as a `role="switch"` with `aria-checked` —
 * Space and Enter toggle natively (it's a <button>).
 *
 * Spec:
 *  - track: 51px wide, 31px tall, radius 16px (fully rounded ends)
 *  - thumb: 27px circle, surface colour, 2px inset from the track edges
 *  - off   : track = var(--track), thumb at left (translate-x-0)
 *  - on    : track = var(--accent), thumb at right (translate-x-[20px])
 *  - transition: 150ms ease-out on both track colour + thumb position
 *
 * The switch is a controlled component: the parent owns `checked` and
 * `onChange`. An optional accessible label is required — the switch has no
 * visible text, so `aria-label` (or a paired <label> via `id`) is the only
 * thing screen readers announce.
 */

export interface SwitchProps {
  /** Whether the switch is on. */
  checked: boolean;
  /** Fires with the next boolean state. */
  onChange: (checked: boolean) => void;
  /** Disable the switch. */
  disabled?: boolean;
  /** Accessible name — required when no visible label is paired via `labelledBy`. */
  'aria-label'?: string;
  /** id of a visible label element that names this switch. */
  'aria-labelledby'?: string;
  /** Optional id for the button element. */
  id?: string;
  /** Optional className for the wrapper. */
  className?: string;
  /** Optional children rendered alongside the switch (a visible label). */
  children?: ReactNode;
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  id,
  className = '',
  children,
  ...aria
}: SwitchProps) {
  const switchEl = (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex shrink-0 items-center',
        'w-[51px] h-[31px] rounded-full',
        'transition-colors duration-150 ease-out',
        'disabled:opacity-40 disabled:pointer-events-none',
        // Focus ring is handled by the global *:focus-visible rule.
        'focus:outline-none',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--track)]',
      ].join(' ')}
      {...aria}
    >
      {/* Thumb — 27px circle, 2px inset, slides 20px when on. */}
      <span
        aria-hidden="true"
        className={[
          'absolute left-[2px] top-[2px]',
          'size-[27px] rounded-full bg-[var(--surface)]',
          'shadow-[0_1px_2px_rgb(16_24_40_/_0.18)]',
          'transition-transform duration-150 ease-out',
          checked ? 'translate-x-[20px]' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );

  // If children are provided, render them in a flex row with the switch.
  // The caller is responsible for wiring the label to the switch via
  // aria-labelledby (pass the label element's id) or aria-label.
  if (children) {
    return (
      <div className={`flex items-center gap-3 ${className}`.trim()}>
        <div className="flex-1 min-w-0">{children}</div>
        {switchEl}
      </div>
    );
  }

  return <span className={className}>{switchEl}</span>;
}

export { Switch as ClearSwitch };
export default Switch;

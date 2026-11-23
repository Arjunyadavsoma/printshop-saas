'use client';

/**
 * Clear design system — stepper.
 *
 * A simple bar-based progress indicator for sequential flows (Files →
 * Options → Pay). N equal-width 4px-tall bars sit side by side; bars
 * before AND including the current step are the accent colour, bars after
 * are the track colour. A glance shows how far through the sequence the
 * customer is.
 *
 * This is the CLEAR stepper — deliberately minimal (no numbers, no
 * circles, no labels). The customer flow is short enough (3 steps) that
 * the bars alone are sufficient; labels would add chrome without adding
 * clarity.
 *
 * Accessibility: the group is a `role="progressbar"` with `aria-valuenow`
 * (1-indexed current step), `aria-valuemin=1`, `aria-valuemax=N`, and an
 * `aria-label` describing the sequence. The individual bars are decorative
 * (`aria-hidden`) — the progressbar semantics on the wrapper carry the
 * meaning for screen readers.
 *
 * Reduced motion: no animation is applied — the colour change is a
 * transition (clamped to ~0ms globally by the prefers-reduced-motion rule
 * in globals.css).
 */

export interface StepperProps {
  /** Total number of steps. Defaults to 3 (the customer checkout flow). */
  steps?: number;
  /** Zero-based index of the current step. Clamped to [0, steps-1]. */
  current: number;
  /** ARIA label for the progressbar. Defaults to "Progress". */
  ariaLabel?: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export function Stepper({
  steps = 3,
  current,
  ariaLabel = 'Progress',
  className = '',
}: StepperProps) {
  if (steps <= 0) return null;
  const clamped = Math.max(0, Math.min(current, steps - 1));
  // 1-indexed value for aria-valuenow (step 1 of N).
  const valueNow = clamped + 1;

  return (
    <div
      role="progressbar"
      aria-valuenow={valueNow}
      aria-valuemin={1}
      aria-valuemax={steps}
      aria-label={ariaLabel}
      className={['flex items-center gap-1.5 w-full', className].join(' ')}
    >
      {Array.from({ length: steps }).map((_, i) => {
        const isDoneOrCurrent = i <= clamped;
        return (
          <span
            key={i}
            aria-hidden="true"
            className={[
              'flex-1 h-1 rounded-full',
              'transition-colors duration-200 ease-out',
              isDoneOrCurrent ? 'bg-[var(--accent)]' : 'bg-[var(--track)]',
            ].join(' ')}
          />
        );
      })}
    </div>
  );
}

export { Stepper as ClearStepper };
export default Stepper;

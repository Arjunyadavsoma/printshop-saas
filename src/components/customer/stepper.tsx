'use client';

import { Check } from 'lucide-react';

/**
 * Stepper — a numbered, horizontal sequence indicator for the customer
 * checkout flow (Files → Options → Pay).
 *
 * The PrintShop brief allows numbering when the steps are an actual
 * sequence — checkout is one. Each step shows its number in a circle;
 * completed steps swap the number for a checkmark. The connector line
 * is filled (cyan-ink) up to the current step and unfilled
 * (border-ink-strong) afterward, so a glance shows progress.
 *
 * The component is display-only (no click handlers) — the steps are a
 * "you are here" affordance, not navigation. Min height 48px so it
 * reads as a real block, not a sliver. The current step carries
 * `aria-current="step"` for screen readers.
 */

interface StepperProps {
  /** Step labels, in order. Typically ['Files', 'Options', 'Pay']. */
  steps: string[];
  /** Zero-based index of the current step. Clamped to [0, steps.length-1]. */
  current: number;
  /** Optional ARIA label for the list. Defaults to "Progress". */
  ariaLabel?: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export function Stepper({ steps, current, ariaLabel = 'Progress', className = '' }: StepperProps) {
  if (steps.length === 0) return null;

  const clamped = Math.max(0, Math.min(current, steps.length - 1));
  // Fraction (0..1) of the way through the steps; used to size the filled
  // segment of the connector line.
  const progress = steps.length > 1 ? clamped / (steps.length - 1) : 0;

  return (
    <div className={`relative px-4 pt-2 pb-1 min-h-[48px] ${className}`.trim()}>
      {/*
        Connector track: a single unfilled line spanning between the
        first and last circle centres (16px in from each edge so the
        line stops at the circle, not the wrapper edge). The filled
        portion overlays it, sized via inline width as a percentage of
        the same span — no layout shift when `current` changes because
        both lines are absolutely positioned and the steps are static.
      */}
      <span
        aria-hidden="true"
        className="absolute top-6 left-8 right-8 h-0.5 bg-[var(--color-border-ink-strong)] rounded-full"
      />
      {clamped > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-6 left-8 h-0.5 bg-[var(--color-cyan-ink)] rounded-full transition-all duration-300 ease-out"
          style={{ width: `calc((100% - 64px) * ${progress})` }}
        />
      )}

      <ol
        className="relative flex justify-between items-start"
        aria-label={ariaLabel}
      >
        {steps.map((label, i) => {
          const isCompleted = i < clamped;
          const isCurrent = i === clamped;

          return (
            <li
              key={`${label}-${i}`}
              className="flex flex-col items-center"
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/*
                Circle: 32px (size-8). Solid cyan-ink fill for completed
                and current steps; surface fill + muted text + 20% ink
                border for future steps. The check icon (4px / size-4)
                is the same width as a single digit so the circle does
                not shift size when state changes.
              */}
              <span
                className={[
                  'relative z-10 flex items-center justify-center',
                  'size-8 rounded-full text-sm font-semibold border-2',
                  'transition-colors duration-200',
                  isCompleted || isCurrent
                    ? 'bg-[var(--color-cyan-ink)] text-white border-[var(--color-cyan-ink)]'
                    : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border-ink-strong)]',
                ].join(' ')}
              >
                {isCompleted ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <span className="tnum">{i + 1}</span>
                )}
              </span>
              <span
                className={[
                  'mt-1.5 text-xs leading-tight text-center max-w-[80px]',
                  isCurrent ? 'text-[var(--color-ink)] font-medium' : 'text-[var(--color-muted)]',
                ].join(' ')}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default Stepper;

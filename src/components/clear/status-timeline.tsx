'use client';

import { Check } from 'lucide-react';

/**
 * Clear design system — status timeline.
 *
 * A vertical timeline of an order's lifecycle (Placed → Payment → Printing
 * → Ready → Collected). The Clear spec (R8) prefers DOTS over numbered
 * circles:
 *  - done    : solid success dot
 *  - current : accent dot with an accent ring around it (the "you are here")
 *  - future  : hollow hairline dot
 *
 * Connecting line: a vertical hairline between dots, omitted after the
 * last step. Labels are 16px / 500; timestamps are 13px / label-2 / tnum.
 */

export type StepStatus = 'done' | 'current' | 'future';

export interface TimelineStep {
  label: string;
  status: StepStatus;
  timestamp?: string;
  subProgress?: string;
}

interface StatusTimelineProps {
  steps: TimelineStep[];
  ariaLabel?: string;
}

export function StatusTimeline({ steps, ariaLabel = 'Order status' }: StatusTimelineProps) {
  return (
    <ol className="flex flex-col" role="list" aria-label={ariaLabel}>
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        return (
          <li key={`${step.label}-${idx}`} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Dot column */}
            <div className="relative flex flex-col items-center shrink-0">
              <Dot status={step.status} />
              {!isLast && (
                <span
                  className={[
                    'absolute top-3 bottom-0 left-1/2 -translate-x-1/2',
                    'w-px',
                    step.status === 'done' ? 'bg-[var(--success)]' : 'bg-[var(--hairline)]',
                  ].join(' ')}
                  aria-hidden="true"
                />
              )}
            </div>
            {/* Body */}
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={[
                    'text-base font-medium leading-tight',
                    step.status === 'future'
                      ? 'text-[var(--label-2)]'
                      : 'text-[var(--label)]',
                  ].join(' ')}
                >
                  {step.label}
                </p>
                {step.timestamp && (
                  <p className="text-[13px] text-[var(--label-2)] tnum shrink-0">
                    {step.timestamp}
                  </p>
                )}
              </div>
              {step.subProgress && (
                <p
                  className="text-[13px] text-[var(--label-2)] mt-1 tnum"
                  role="status"
                  aria-live="polite"
                >
                  {step.subProgress}
                </p>
              )}
              <span className="sr-only">
                {step.status === 'done' && 'Completed'}
                {step.status === 'current' && 'In progress'}
                {step.status === 'future' && 'Upcoming'}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A 12px dot with state-specific styling. */
function Dot({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span
        className="size-3 rounded-full bg-[var(--success)] flex items-center justify-center"
        aria-hidden="true"
      >
        <Check className="size-2.5 text-white" strokeWidth={4} />
      </span>
    );
  }
  if (status === 'current') {
    return (
      <span
        className="size-3 rounded-full bg-[var(--accent)] ring-4 ring-[var(--accent-tint)]"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="size-3 rounded-full bg-[var(--surface)] border-2 border-[var(--hairline)]"
      aria-hidden="true"
    />
  );
}

export { StatusTimeline as ClearStatusTimeline };
export default StatusTimeline;

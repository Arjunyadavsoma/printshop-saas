'use client';

import { Check } from 'lucide-react';
import { STEP_ORDER, STEP_LABELS, type StudioStep } from './types';

/**
 * StudioStepper — the 5-step workflow progress indicator.
 *
 * Shows Upload → Print settings → Review → Payment → Done with the active
 * step highlighted in the consumer blue. Completed steps show a check.
 * Horizontally scrollable on mobile (no overflow), inline on desktop.
 */
export function StudioStepper({ current }: { current: StudioStep }) {
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <nav aria-label="Print studio progress" className="flex items-center gap-1 overflow-x-auto sm:gap-2">
      {STEP_ORDER.map((step, idx) => {
        const isDone = idx < currentIdx;
        const isActive = idx === currentIdx;
        const label = STEP_LABELS[step];
        return (
          <div key={step} className="flex items-center gap-1 sm:gap-2">
            {idx > 0 && (
              <span
                className={['h-px w-4 sm:w-8', isDone || isActive ? 'bg-[var(--accent)]' : 'bg-[var(--hairline)]'].join(' ')}
                aria-hidden="true"
              />
            )}
            <div className="flex items-center gap-2">
              <span
                className={[
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors',
                  isDone
                    ? 'bg-[var(--accent)] text-white'
                    : isActive
                      ? 'bg-[var(--accent)] text-white ring-4 ring-[var(--accent-tint)]'
                      : 'bg-[var(--ground)] text-[var(--label-3)] border border-[var(--hairline)]',
                ].join(' ')}
                aria-current={isActive ? 'step' : undefined}
              >
                {isDone ? <Check className="size-3.5" aria-hidden="true" /> : idx + 1}
              </span>
              <span
                className={[
                  'whitespace-nowrap text-[13px] font-semibold',
                  isActive ? 'text-[var(--label)]' : isDone ? 'text-[var(--label-2)]' : 'text-[var(--label-3)]',
                ].join(' ')}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

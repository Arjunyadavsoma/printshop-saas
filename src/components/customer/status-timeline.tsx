'use client';

import { Check } from 'lucide-react';

/**
 * StatusTimeline — a numbered vertical timeline of an order's lifecycle.
 *
 * The PrintShop customer flow has a fixed mental model of where an order is:
 * Placed → Payment → Printing → Ready → Collected. This component renders
 * that journey as a sequence of numbered steps connected by a vertical line,
 * so the customer can see at a glance what's done, what's happening now,
 * and what's left.
 *
 * Step states:
 *  - **done**    — solid success-green fill with a check icon. The customer
 *                  doesn't need to re-read these, but the green provides
 *                  reassuring forward progress.
 *  - **current** — solid cyan-ink fill with a soft pulse. This is the
 *                  step the customer is waiting on; the pulse is a subtle
 *                  "something is happening" affordance (respects
 *                  prefers-reduced-motion via Tailwind's animate-pulse,
 *                  which the OS can suppress).
 *  - **future**  — muted outline circle. Shows the remaining path without
 *                  implying any action is available yet.
 *
 * The "Printing" step can show a `subProgress` line (e.g. "Colour: 3 of 5
 * pages done") for per-set progress when the shop is mid-print. This is
 * rendered as muted small text under the step name.
 *
 * The connecting line is drawn as a left-aligned border on the step rows so
 * it naturally stops at the last step (no trailing line below "Collected").
 */

/** The lifecycle state of a single timeline step. */
export type StepStatus = 'done' | 'current' | 'future';

/** A single step in the order lifecycle. */
export interface TimelineStep {
  /** Step name, e.g. "Placed", "Payment", "Printing", "Ready", "Collected". */
  label: string;
  /** Lifecycle state — drives the circle fill + line colour. */
  status: StepStatus;
  /** Optional human timestamp, e.g. "2:14 PM, today". */
  timestamp?: string;
  /**
   * Optional per-step progress caption (e.g. "Colour: 3 of 5 pages done").
   * Rendered as muted small text below the label. Typically only present
   * on the current "Printing" step.
   */
  subProgress?: string;
}

interface StatusTimelineProps {
  /** Ordered list of steps, top = earliest. Numbering is positional (1-based). */
  steps: TimelineStep[];
  /** Optional screen-reader heading for the region. Defaults to "Order status". */
  ariaLabel?: string;
}

/** Visual config for each step status — circle classes + connecting line. */
const stepVisuals: Record<StepStatus, { circle: string; line: string }> = {
  done: {
    circle: 'bg-[var(--color-success)] text-white border-[var(--color-success)]',
    line: 'border-[var(--color-border-ink)]',
  },
  current: {
    circle: 'bg-[var(--color-cyan-ink)] text-white border-[var(--color-cyan-ink)] animate-pulse',
    line: 'border-[var(--color-border-ink)]',
  },
  future: {
    circle: 'bg-transparent text-[var(--color-muted)] border-[var(--color-border-ink-strong)]',
    line: 'border-[var(--color-border-ink)]',
  },
};

export function StatusTimeline({ steps, ariaLabel = 'Order status' }: StatusTimelineProps) {
  return (
    <ol
      className="flex flex-col"
      role="list"
      aria-label={ariaLabel}
    >
      {steps.map((step, idx) => {
        const visuals = stepVisuals[step.status];
        const isLast = idx === steps.length - 1;
        const stepNumber = idx + 1;

        return (
          <li key={`${step.label}-${idx}`} className="relative flex gap-3 pb-4 last:pb-0">
            {/* ── Number circle ── */}
            <div className="relative flex flex-col items-center shrink-0">
              <span
                className={[
                  'size-8 rounded-full border-2',
                  'flex items-center justify-center',
                  'text-sm font-semibold tnum',
                  'transition-colors',
                  visuals.circle,
                ].join(' ')}
                aria-hidden="true"
              >
                {step.status === 'done' ? (
                  <Check className="size-4" strokeWidth={3} />
                ) : (
                  stepNumber
                )}
              </span>

              {/* Connecting line — drawn as a border on an absolutely
                  positioned span so it can be omitted on the last step
                  without leaving a dangling border fragment. */}
              {!isLast && (
                <span
                  className={[
                    'absolute top-8 bottom-0 left-1/2 -translate-x-1/2',
                    'w-0 border-l-2',
                    visuals.line,
                  ].join(' ')}
                  aria-hidden="true"
                />
              )}
            </div>

            {/* ── Step body ── */}
            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={[
                    'text-sm font-medium leading-tight',
                    step.status === 'future'
                      ? 'text-[var(--color-muted)]'
                      : 'text-[var(--color-ink)]',
                  ].join(' ')}
                >
                  {step.label}
                </p>
                {step.timestamp && (
                  <p className="text-xs text-[var(--color-muted)] tnum shrink-0">
                    {step.timestamp}
                  </p>
                )}
              </div>

              {step.subProgress && (
                <p
                  className="text-xs text-[var(--color-muted)] mt-1 tnum"
                  role="status"
                  aria-live="polite"
                >
                  {step.subProgress}
                </p>
              )}

              {/* sr-only status label so screen readers announce the step's
                  lifecycle state, not just its name. */}
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

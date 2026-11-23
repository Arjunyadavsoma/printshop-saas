'use client';

import { type ReactNode } from 'react';

/**
 * Clear design system — empty state.
 *
 * Centred: a Lucide icon in an accent-tint circle, a sentence-case title,
 * a plain-spoken description, and an optional action.
 *
 * Copy rule (enforced by the caller): inviting, not clinical. e.g.
 * "Add a PDF, photo or Word file to start." — tell the customer what to
 * do next, in their words.
 *
 * The icon circle uses accent-tint (soft) + accent-tint-text colour rather
 * than a solid accent fill — the Clear language prefers tints for
 * decorative affordances, reserving solid accent for the primary action.
 */

export interface EmptyStateAction {
  /** The button label — verb-led, e.g. "Add a file". */
  label: string;
  /** Click handler. */
  onClick: () => void;
}

export interface EmptyStateProps {
  /** A Lucide icon node. Pass it pre-sized (~28px), e.g. `<FilePlus className="size-7" />`. */
  icon: ReactNode;
  /** One-line title, sentence case, e.g. "No files yet". */
  title: string;
  /** Plain-spoken next-step, e.g. "Add a PDF, photo or Word file to start." */
  description: string;
  /** Optional action shown below the copy. When provided, render a TintedButton. */
  action?: EmptyStateAction;
  /** Optional className for the wrapper. */
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center px-6 py-12',
        className,
      ].join(' ')}
      role="status"
    >
      {/* Icon in an accent-tint circle */}
      <div
        className="flex items-center justify-center size-14 rounded-full bg-[var(--accent-tint)] text-[var(--accent-tint-text)]"
        aria-hidden="true"
      >
        {icon}
      </div>

      <h2 className="mt-4 text-lg font-semibold text-[var(--label)]">{title}</h2>

      <p className="mt-1 text-sm text-[var(--label-2)] max-w-xs">{description}</p>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={[
            'mt-5 inline-flex items-center justify-center',
            'min-h-[44px] px-4 text-[15px] font-semibold rounded-full',
            'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]',
            'transition-colors duration-150 hover:brightness-95 active:brightness-90',
            'focus:outline-none',
          ].join(' ')}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export { EmptyState as ClearEmptyState };
export default EmptyState;

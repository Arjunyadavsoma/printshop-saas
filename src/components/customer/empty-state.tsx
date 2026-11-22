'use client';

import { type ReactNode } from 'react';
import { SecondaryButton } from './button';

/**
 * EmptyState — the "nothing here yet" panel.
 *
 * Centred: a lucide icon in a cyan-ink tinted circle, a sentence-case
 * title, a plain-spoken description, and an optional secondary action.
 *
 * Copy rule (enforced by the caller, not the component): inviting, not
 * clinical. e.g. "Add a PDF, photo or Word file to start." — tell the
 * customer what to do next, in their words.
 */

interface EmptyStateAction {
  /** The button label — verb-led, e.g. "Add a file". */
  label: string;
  /** Click handler. */
  onClick: () => void;
}

interface EmptyStateProps {
  /** A lucide icon node. Pass it pre-sized (~28px), e.g. `<FilePlus className="size-7" />`. */
  icon: ReactNode;
  /** One-line title, sentence case, e.g. "No files yet". */
  title: string;
  /** Plain-spoken next-step, e.g. "Add a PDF, photo or Word file to start." */
  description: string;
  /** Optional secondary action shown below the copy. */
  action?: EmptyStateAction;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-6 py-12"
      role="status"
    >
      {/* Icon in a cyan-ink tinted circle (the C in CMYK) */}
      <div
        className="flex items-center justify-center size-14 rounded-full bg-[rgb(0_111_166_/_0.12)] text-[var(--color-cyan-ink)]"
        aria-hidden="true"
      >
        {icon}
      </div>

      <h2 className="mt-4 text-lg font-semibold text-[var(--color-ink)]">
        {title}
      </h2>

      <p className="mt-1 text-sm text-[var(--color-muted)] max-w-xs">
        {description}
      </p>

      {action && (
        <SecondaryButton className="mt-5" onClick={action.onClick}>
          {action.label}
        </SecondaryButton>
      )}
    </div>
  );
}

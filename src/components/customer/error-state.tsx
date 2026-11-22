'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { PrimaryButton } from './button';

/**
 * ErrorState — the "something went wrong" panel.
 *
 * Centred: a red AlertCircle in an error-tinted circle, a sentence that
 * says WHAT happened, an optional sentence that says HOW to fix it, and a
 * retry button. Never says "Sorry" or stays vague — the `message` always
 * names the failure, and `fix` always names the recovery.
 *
 * Example copy (passed by the caller):
 *   message: "We couldn't load this shop."
 *   fix:     "Check your connection and try again."
 */

interface ErrorStateProps {
  /** What happened — specific, not "Something went wrong". */
  message: string;
  /** How to fix it — the next physical action the customer can take. */
  fix?: string;
  /** Retry handler. When omitted, no retry button is rendered. */
  onRetry?: () => void;
}

export function ErrorState({ message, fix, onRetry }: ErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-6 py-12"
      role="alert"
    >
      {/* Error icon in an error-tinted circle */}
      <div
        className="flex items-center justify-center size-14 rounded-full bg-[rgb(179_38_30_/_0.12)] text-[var(--color-error)]"
        aria-hidden="true"
      >
        <AlertCircle className="size-7" />
      </div>

      {/* What happened — text-base so it's not whispered */}
      <p className="mt-4 text-base font-medium text-[var(--color-ink)] max-w-xs">
        {message}
      </p>

      {/* How to fix it — muted, smaller */}
      {fix && (
        <p className="mt-2 text-sm text-[var(--color-muted)] max-w-xs">
          {fix}
        </p>
      )}

      {onRetry && (
        <PrimaryButton className="mt-5" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </PrimaryButton>
      )}
    </div>
  );
}

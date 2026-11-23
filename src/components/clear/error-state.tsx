'use client';

import { type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * Clear design system — error state.
 *
 * Centred: a danger AlertCircle in a danger-tint circle, a sentence that
 * says WHAT happened, an optional sentence that says HOW to fix it, an
 * optional reference code (Next.js error `digest` / request id) so the
 * customer can quote it to support without pasting a stack trace, and a
 * retry button. Never says "Sorry" or stays vague — the `message` always
 * names the failure, and `fix` always names the recovery.
 *
 * The reference code is the operator-side correlation key. The customer
 * should NEVER see a raw stack trace (it leaks internals — file paths,
 * library versions, internal class names). The reference code is enough
 * for the operator to find the real stack in logs / Sentry via the
 * request id / digest.
 *
 * Example copy (passed by the caller):
 *   message:       "We couldn't load this shop."
 *   fix:           "Check your connection and try again."
 *   referenceCode: "4f3a9b" (from error.digest)
 */

export interface ErrorStateProps {
  /** What happened — specific, not "Something went wrong". */
  message: string;
  /** How to fix it — the next physical action the customer can take. */
  fix?: string;
  /**
   * Operator-side correlation key (Next.js error `digest`, or an
   * X-Request-Id). Rendered as a small muted line under the fix text so
   * the customer can quote it to support. NOT a stack trace.
   */
  referenceCode?: string;
  /** Retry handler. When omitted, no retry button is rendered. */
  onRetry?: () => void;
  /** Optional retry button label. Defaults to "Try again". */
  retryLabel?: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export function ErrorState({
  message,
  fix,
  referenceCode,
  onRetry,
  retryLabel = 'Try again',
  className = '',
}: ErrorStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center px-6 py-12',
        className,
      ].join(' ')}
      role="alert"
    >
      {/* Error icon in a danger-tint circle */}
      <div
        className="flex items-center justify-center size-14 rounded-full bg-[var(--danger-tint)] text-[var(--danger-text)]"
        aria-hidden="true"
      >
        <AlertCircle className="size-7" />
      </div>

      {/* What happened */}
      <p className="mt-4 text-base font-medium text-[var(--label)] max-w-xs">{message}</p>

      {/* How to fix it */}
      {fix && (
        <p className="mt-2 text-sm text-[var(--label-2)] max-w-xs">{fix}</p>
      )}

      {/* Reference code — selectable so the customer can copy it */}
      {referenceCode && (
        <p className="mt-3 text-xs text-[var(--label-3)] max-w-xs select-all font-mono">
          Reference: {referenceCode}
        </p>
      )}

      {/* Retry button */}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={[
            'mt-5 inline-flex items-center justify-center gap-2',
            'min-h-[44px] px-4 text-[15px] font-semibold rounded-full',
            'bg-[var(--accent)] text-[var(--on-accent)]',
            'transition-colors duration-150 hover:bg-[var(--accent-press)] active:bg-[var(--accent-press)]',
            'focus:outline-none',
          ].join(' ')}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export { ErrorState as ClearErrorState };
export default ErrorState;

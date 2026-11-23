'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { PrimaryButton } from './button';

/**
 * ErrorState — the "something went wrong" panel.
 *
 * Centred: a red AlertCircle in an error-tinted circle, a sentence that
 * says WHAT happened, an optional sentence that says HOW to fix it, an
 * optional reference code (Next.js error `digest` / request id) so the
 * customer can quote it to support without pasting a stack trace, and a
 * retry button. Never says "Sorry" or stays vague — the `message` always
 * names the failure, and `fix` always names the recovery.
 *
 * P9-Security §6: the reference code is the operator-side correlation key.
 * The customer should NEVER see a raw stack trace (it leaks internals —
 * file paths, library versions, internal class names — to anyone who can
 * screenshot the page). The reference code is enough for the operator to
 * find the real stack in logs / Sentry via the request id / digest.
 *
 * Example copy (passed by the caller):
 *   message:       "We couldn't load this shop."
 *   fix:           "Check your connection and try again."
 *   referenceCode: "4f3a9b" (from error.digest)
 */

interface ErrorStateProps {
  /** What happened — specific, not "Something went wrong". */
  message: string;
  /** How to fix it — the next physical action the customer can take. */
  fix?: string;
  /**
   * Operator-side correlation key (Next.js error `digest`, or an
   * X-Request-Id). Rendered as a small muted line under the fix text so
   * the customer can quote it to support. NOT a stack trace — a short
   * opaque id only.
   */
  referenceCode?: string;
  /** Retry handler. When omitted, no retry button is rendered. */
  onRetry?: () => void;
}

export function ErrorState({ message, fix, referenceCode, onRetry }: ErrorStateProps) {
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

      {/* Reference code — operator-side correlation key. Muted + small so
          it doesn't draw attention, but selectable so the customer can copy
          it into a support chat. */}
      {referenceCode && (
        <p className="mt-3 text-xs text-[var(--color-muted)] max-w-xs select-all font-mono">
          Reference: {referenceCode}
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

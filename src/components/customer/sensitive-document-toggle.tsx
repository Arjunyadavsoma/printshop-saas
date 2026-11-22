'use client';

import { Shield } from 'lucide-react';

/**
 * SensitiveDocumentToggle — for Aadhaar/PAN/IDs.
 *
 * When enabled: the order requires a pickup code (the customer can't
 * download files online — they must show the code at the counter).
 * Files are deleted immediately after printing (not the usual 24h).
 *
 * This is a P5 privacy requirement: "Sensitive document toggle (for
 * Aadhaar/PAN: requires pickup code, deleted right after printing)".
 *
 * The toggle is a simple switch with a clear label + explanation.
 * It appears in the review/pay step of the order flow.
 */

interface SensitiveDocumentToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function SensitiveDocumentToggle({ enabled, onChange }: SensitiveDocumentToggleProps) {
  return (
    <label
      className={[
        'flex items-start gap-3 p-4 rounded-[var(--radius-default)] border cursor-pointer transition-colors',
        enabled
          ? 'border-[var(--color-cyan-ink)] bg-[var(--color-cyan-ink)]/5'
          : 'border-[var(--color-border-ink)] bg-[var(--color-surface)]',
      ].join(' ')}
    >
      <div className={[
        'flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-default)]',
        enabled ? 'bg-[var(--color-cyan-ink)]/10' : 'bg-[var(--color-paper)]',
      ].join(' ')}>
        <Shield
          className={['size-5', enabled ? 'text-[var(--color-cyan-ink)]' : 'text-[var(--color-muted)]'].join(' ')}
          aria-hidden="true"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-medium text-[var(--color-ink)]">
            Sensitive document
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked)}
            className="touch-target sr-only"
            aria-describedby="sensitive-desc"
          />
          {/* Visual switch */}
          <span
            className={[
              'relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors',
              enabled ? 'bg-[var(--color-cyan-ink)]' : 'bg-[var(--color-border-ink-strong)]',
            ].join(' ')}
            aria-hidden="true"
          >
            <span
              className={[
                'absolute top-1 size-5 rounded-full bg-white transition-transform',
                enabled ? 'translate-x-6' : 'translate-x-1',
              ].join(' ')}
            />
          </span>
        </div>
        <p id="sensitive-desc" className="text-sm text-[var(--color-muted)] mt-1">
          {enabled
            ? 'Files are deleted right after printing. Pickup code required — no online download.'
            : 'For Aadhaar, PAN, or ID copies. Files are deleted immediately after printing instead of the usual 24 hours.'}
        </p>
      </div>
    </label>
  );
}

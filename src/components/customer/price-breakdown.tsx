'use client';

import { useState, useId, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * PriceBreakdown — a collapsible price summary for the customer flow.
 *
 * On mobile, the customer usually only cares about the total. The full
 * breakdown (B&W pages, colour pages, double-sided discount, add-ons) is
 * available on demand via a "See breakdown" toggle. This keeps the order
 * summary scannable while still providing the audit trail shoppers want
 * before paying.
 *
 * All amounts are stored and passed as paise (integer, 1 rupee = 100 paise)
 * to avoid floating-point rounding errors. The {@link formatRupees} helper
 * formats them for display using the Indian numbering system (lakh / crore
 * grouping) via `Intl.NumberFormat('en-IN')`.
 *
 * Tabular numerals (`.tnum`) are applied to every amount so digits align
 * vertically across rows — important for the eye to scan a column of prices.
 */

/** A single priced line in the breakdown (e.g. "Colour pages: ₹24"). */
export interface PriceLine {
  /** Human-readable label, e.g. "B&W pages", "Double-sided discount". */
  label: string;
  /**
   * The amount in paise. Negative values are discounts and are rendered
   * with a leading minus sign. Pass paise (not rupees) to avoid float drift.
   */
  amountPaise: number;
}

interface PriceBreakdownProps {
  /** Grand total in paise. Shown collapsed and as the bold final row. */
  totalPaise: number;
  /** The itemised lines (B&W, Colour, discounts, add-ons, etc.). */
  lines: PriceLine[];
  /** Whether to render expanded on first mount. Defaults to collapsed. */
  defaultExpanded?: boolean;
  /**
   * Optional ReactNode rendered to the right of the collapsed total —
   * typically a {@link StatusPill}. Kept optional so the component stays
   * focused on price; callers compose it into the wider summary card.
   */
  trailing?: ReactNode;
}

/**
 * Format a paise amount as an Indian-rupee string.
 *
 * Examples:
 *   formatRupees(4800)   → "₹48"
 *   formatRupees(4850)   → "₹48.50"
 *   formatRupees(-200)   → "-₹2"
 *
 * Uses `en-IN` locale so large totals use lakh/crore grouping. Drops
 * trailing ".00" to keep collapsed totals compact ("₹48", not "₹48.00").
 * Negative amounts (discounts) keep the minus sign before the symbol.
 */
export function formatRupees(paise: number): string {
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = absPaise / 100;
  const hasFraction = absPaise % 100 !== 0;

  // Two fraction digits only when there are paise; otherwise whole rupees.
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);

  return `${isNegative ? '-' : ''}₹${formatted}`;
}

export function PriceBreakdown({
  totalPaise,
  lines,
  defaultExpanded = false,
  trailing,
}: PriceBreakdownProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const regionId = useId();

  return (
    <section
      className="rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] overflow-hidden"
      aria-labelledby={`${regionId}-heading`}
    >
      {/* ── Collapsed summary row ── */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={`${regionId}-detail`}
        className="touch-target w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
          <span
            id={`${regionId}-heading`}
            className="text-xl font-semibold text-[var(--color-ink)] tnum leading-tight"
          >
            {formatRupees(totalPaise)}
          </span>
          <span className="text-sm text-[var(--color-muted)] leading-tight">total</span>
        </span>

        {trailing && <span className="shrink-0">{trailing}</span>}

        <span
          className="shrink-0 inline-flex items-center gap-1 text-sm text-[var(--color-cyan-ink)] font-medium"
        >
          {expanded ? 'Hide' : 'See breakdown'}
          {expanded ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </span>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div
          id={`${regionId}-detail`}
          role="region"
          aria-labelledby={`${regionId}-heading`}
          className="border-t border-[var(--color-border-ink)] px-4 py-3"
        >
          <dl className="space-y-2">
            {lines.map((line, idx) => {
              const isDiscount = line.amountPaise < 0;
              return (
                <div
                  key={`${line.label}-${idx}`}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt className="text-sm text-[var(--color-muted)]">{line.label}</dt>
                  <dd
                    className={[
                      'text-sm tnum font-medium tabular-nums',
                      isDiscount ? 'text-[var(--color-success)]' : 'text-[var(--color-ink)]',
                    ].join(' ')}
                  >
                    {formatRupees(line.amountPaise)}
                  </dd>
                </div>
              );
            })}
          </dl>

          {/* Total row — visually heavier, separated by a hairline rule. */}
          <div className="mt-3 pt-3 border-t border-[var(--color-border-ink)] flex items-baseline justify-between gap-4">
            <dt className="text-sm font-semibold text-[var(--color-ink)]">Total</dt>
            <dd
              className="text-lg font-semibold text-[var(--color-ink)] tnum tabular-nums"
            >
              {formatRupees(totalPaise)}
            </dd>
          </div>
        </div>
      )}
    </section>
  );
}

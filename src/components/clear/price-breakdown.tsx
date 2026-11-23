'use client';

import { useState, useId, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Clear design system — price breakdown.
 *
 * A collapsible price summary. On mobile the customer usually only cares
 * about the total; the full breakdown (B&W pages, colour pages, double-
 * sided discount, add-ons) is available on demand via a "See breakdown"
 * toggle. This keeps the summary scannable while still providing the audit
 * trail shoppers want before paying.
 *
 * Collapsed: "{total} total" + "See breakdown" toggle.
 * Expanded : itemised lines (label left, amount right) + a bold total row,
 *            separated by a hairline.
 *
 * All amounts are stored and passed as paise (integer, 1 rupee = 100 paise)
 * to avoid floating-point rounding errors. The {@link formatRupees} helper
 * formats them for display using the Indian numbering system (lakh / crore
 * grouping) via `Intl.NumberFormat('en-IN')`.
 *
 * Tabular numerals (`.tnum`) are applied to every amount so digits align
 * vertically across rows.
 */

/** A single priced line in the breakdown (e.g. "Colour pages: ₹24"). */
export interface PriceLine {
  /** Human-readable label. */
  label: string;
  /**
   * The amount in paise. Negative values are discounts and are rendered
   * with a leading minus sign. Pass paise (not rupees) to avoid float drift.
   */
  amountPaise: number;
}

export interface PriceBreakdownProps {
  /** Grand total in paise. Shown collapsed and as the bold final row. */
  totalPaise: number;
  /** The itemised lines (B&W, Colour, discounts, add-ons, etc.). */
  lines: PriceLine[];
  /** Whether to render expanded on first mount. Defaults to collapsed. */
  defaultExpanded?: boolean;
  /**
   * Optional ReactNode rendered to the right of the collapsed total —
   * typically a StatusPill. Kept optional so the component stays focused
   * on price.
   */
  trailing?: ReactNode;
  /** Optional className. */
  className?: string;
}

/**
 * Format a paise amount as an Indian-rupee string.
 *   formatRupees(4800)   → "₹48"
 *   formatRupees(4850)   → "₹48.50"
 *   formatRupees(-200)   → "-₹2"
 *
 * Uses `en-IN` locale so large totals use lakh/crore grouping. Drops
 * trailing ".00" to keep collapsed totals compact.
 */
export function formatRupees(paise: number): string {
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = absPaise / 100;
  const hasFraction = absPaise % 100 !== 0;

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
  className = '',
}: PriceBreakdownProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const regionId = useId();

  return (
    <section
      className={[
        'rounded-[var(--radius-card)] bg-[var(--surface)] border border-[var(--hairline)] overflow-hidden',
        className,
      ].join(' ')}
      aria-labelledby={`${regionId}-heading`}
    >
      {/* Collapsed summary row */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={`${regionId}-detail`}
        className="w-full flex items-center gap-3 px-4 py-3 text-left min-h-[48px] focus:outline-none"
      >
        <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
          <span
            id={`${regionId}-heading`}
            className="text-xl font-bold text-[var(--label)] tnum leading-tight"
          >
            {formatRupees(totalPaise)}
          </span>
          <span className="text-sm text-[var(--label-2)] leading-tight">total</span>
        </span>

        {trailing && <span className="shrink-0">{trailing}</span>}

        <span className="shrink-0 inline-flex items-center gap-1 text-sm text-[var(--accent)] font-medium">
          {expanded ? 'Hide' : 'See breakdown'}
          {expanded ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          id={`${regionId}-detail`}
          role="region"
          aria-labelledby={`${regionId}-heading`}
          className="border-t border-[var(--hairline)] px-4 py-3"
        >
          <dl className="space-y-2">
            {lines.map((line, idx) => {
              const isDiscount = line.amountPaise < 0;
              return (
                <div
                  key={`${line.label}-${idx}`}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt className="text-sm text-[var(--label-2)]">{line.label}</dt>
                  <dd
                    className={[
                      'text-sm tnum font-medium',
                      isDiscount ? 'text-[var(--success-text)]' : 'text-[var(--label)]',
                    ].join(' ')}
                  >
                    {formatRupees(line.amountPaise)}
                  </dd>
                </div>
              );
            })}
          </dl>

          {/* Total row */}
          <div className="mt-3 pt-3 border-t border-[var(--hairline)] flex items-baseline justify-between gap-4">
            <dt className="text-sm font-semibold text-[var(--label)]">Total</dt>
            <dd className="text-lg font-bold text-[var(--label)] tnum">
              {formatRupees(totalPaise)}
            </dd>
          </div>
        </div>
      )}
    </section>
  );
}

export { PriceBreakdown as ClearPriceBreakdown, formatRupees as clearFormatRupees };
export default PriceBreakdown;

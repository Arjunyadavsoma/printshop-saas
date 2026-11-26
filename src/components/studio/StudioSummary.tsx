'use client';

import { FileText, Layers } from 'lucide-react';
import type { Quote, ShopCapabilities } from './types';
import { formatRupees } from './types';

/**
 * StudioSummary — the sticky right-rail price + page-count panel (desktop).
 *
 * Shows a live, server-authoritative breakdown:
 *   - file count, total pages (B/W vs colour)
 *   - copies
 *   - line items (from the quote)
 *   - subtotal, add-ons, total
 *
 * The mobile equivalent is the compact bottom bar rendered inline in the
 * orchestrator (MobileSummary) — this component is desktop-only.
 */
export function StudioSummary({
  quote, quoting, totalFiles, totalPages, colourPages, bwPages, copies, shop,
}: {
  quote: Quote | null;
  quoting: boolean;
  totalFiles: number;
  totalPages: number;
  colourPages: number;
  bwPages: number;
  copies: number;
  shop: ShopCapabilities;
}) {
  const total = quote?.totalPaise ?? null;
  const isEstimate = quote?.ruleMissing || (quote?.warnings?.length ?? 0) > 0;

  return (
    <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--label)]">
        <Layers className="size-4 text-[var(--accent)]" aria-hidden="true" />
        Order summary
      </h2>

      {/* Counts */}
      <dl className="mt-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <dt className="flex items-center gap-1.5 text-[13px] text-[var(--label-2)]">
            <FileText className="size-3.5" aria-hidden="true" /> Documents
          </dt>
          <dd className="text-[13px] font-semibold text-[var(--label)]">{totalFiles}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[13px] text-[var(--label-2)]">Total pages</dt>
          <dd className="text-[13px] font-semibold text-[var(--label)]">{totalPages}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[13px] text-[var(--label-2)]">B&W pages</dt>
          <dd className="text-[13px] font-semibold text-[var(--label)]">{bwPages}</dd>
        </div>
        {shop.supportsColor && (
          <div className="flex items-center justify-between">
            <dt className="text-[13px] text-[var(--label-2)]">Colour pages</dt>
            <dd className="text-[13px] font-semibold text-[var(--label)]">{colourPages}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="text-[13px] text-[var(--label-2)]">Copies</dt>
          <dd className="text-[13px] font-semibold text-[var(--label)]">{copies}</dd>
        </div>
      </dl>

      {/* Line items */}
      {quote && quote.lines.length > 0 && (
        <div className="mt-4 border-t border-[var(--hairline)] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-3)]">Printing charges</p>
          <ul className="mt-2 space-y-1.5">
            {quote.lines.map((line, i) => (
              <li key={i} className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--label-2)]">
                  {line.colorMode === 'COLOR' ? 'Colour' : 'B&W'} · {line.pages}p × {line.copies}
                </span>
                <span className="font-medium text-[var(--label)]">{formatRupees(line.linePaise)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Add-ons */}
      {quote && quote.addonsPaise > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-3)]">Add-ons</p>
          <ul className="mt-1.5 space-y-1">
            {quote.addonsDetail.map((a, i) => (
              <li key={i} className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--label-2)]">{a.label} × {a.quantity}</span>
                <span className="font-medium text-[var(--label)]">{formatRupees(a.linePaise)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Total */}
      <div className="mt-4 border-t border-[var(--hairline)] pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold text-[var(--label)]">
            {quoting ? 'Calculating…' : 'Total'}
          </span>
          <span className="text-[22px] font-bold text-[var(--accent)]">
            {quoting ? '—' : formatRupees(total)}
          </span>
        </div>
        {isEstimate && !quoting && (
          <p className="mt-1.5 rounded-[8px] bg-[var(--warning-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--warning)]">
            Estimated price — the final amount is confirmed at checkout.
          </p>
        )}
        {!quoting && !quote && totalFiles === 0 && (
          <p className="mt-1.5 text-[12px] text-[var(--label-3)]">
            Upload a document to see pricing.
          </p>
        )}
      </div>

      {/* Min order notice */}
      {quote && quote.totalPaise != null && quote.totalPaise < shop.pricingSummary.minOrderValue && (
        <p className="mt-3 rounded-[8px] bg-[var(--accent-tint)] px-3 py-2 text-[12px] text-[var(--accent-tint-text)]">
          Minimum order is {formatRupees(shop.pricingSummary.minOrderValue)}.
        </p>
      )}
    </div>
  );
}

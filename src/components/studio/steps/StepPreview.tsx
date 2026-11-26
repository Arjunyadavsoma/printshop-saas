'use client';

import {
  ArrowLeft,
  ArrowRight,
  FileText,
  AlertTriangle,
  Store,
  Receipt,
  Layers,
  User,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import type { StudioFile, ShopCapabilities, Quote, PrintSettings } from '../types';
import { formatSize, formatRupees } from '../types';
import { PrimaryButton } from '@/components/clear/button';

/**
 * Step 3 — Preview & Review (complete order review).
 *
 * Shows every uploaded document with its full print settings (mode, copies,
 * paper, sides, colour page ranges, add-ons), the itemized quote breakdown
 * (lines, addons, urgent, total), the customer contact details the shop will
 * use to send updates, and a prominent "Proceed to payment" CTA.
 *
 * If the quote is missing pricing rules (`ruleMissing`) or has no
 * `totalPaise`, a warning banner replaces the proceed button — the customer
 * must fix the print settings or contact the shop.
 *
 * Props
 *   Required: files, shop, shopName, quote, onBack, onProceed.
 *   Optional: customerName / customerPhone / note + setters — preserved
 *   from the existing flow so the orchestrator can still validate the phone
 *   before enabling `onProceed` (the `canProceed` derived flag below).
 */
export interface StepPreviewProps {
  files: StudioFile[];
  shop: ShopCapabilities;
  shopName: string;
  quote: Quote | null;
  onBack: () => void;
  onProceed: () => void;
  // Optional customer-details (preserved from the prior interface).
  customerName?: string;
  customerPhone?: string;
  onCustomerName?: (v: string) => void;
  onCustomerPhone?: (v: string) => void;
  note?: string;
  onNote?: (v: string) => void;
}

/** Format a page-range compactly: [1,2,3,5,6] → "1-3, 5-6". */
function formatRanges(pages: number[]): string {
  if (pages.length === 0) return '—';
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}

/** Human-readable print-mode label. */
function modeLabel(s: PrintSettings): string {
  if (s.mode === 'colour') return 'Colour';
  if (s.mode === 'mixed') return `Mixed (${s.colourPages.length} colour)`;
  return 'B&W';
}

export function StepPreview({
  files,
  shop,
  shopName,
  quote,
  onBack,
  onProceed,
  customerName,
  customerPhone,
  onCustomerName,
  onCustomerPhone,
  note,
  onNote,
}: StepPreviewProps) {
  const readyFiles = files.filter((f) => f.status === 'ready' && f.pageCount);

  // Quote health — we only allow proceeding when the quote has a real total
  // and no ruleMissing (the price rules cover every selected mode).
  const quoteReady = quote != null && quote.totalPaise != null && !quote.ruleMissing;
  const quoteMissingRule = quote?.ruleMissing ?? false;
  const quoteNoTotal = quote == null || quote.totalPaise == null;

  // Customer-details validation (preserved from the prior flow).
  const phoneDigits = (customerPhone ?? '').replace(/\D/g, '');
  const phoneValid = phoneDigits.length >= 10;
  const canProceed = quoteReady && phoneValid;

  // The "Proceed to payment" button label shows the live total.
  const proceedLabel = quoteReady
    ? `Proceed to payment · ${formatRupees(quote!.totalPaise)}`
    : 'Proceed to payment';

  return (
    <div className="space-y-4 pb-28 lg:pb-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold text-[var(--label)]">Review your order</h1>
          <p className="mt-1 text-[14px] text-[var(--label-2)]">
            Check everything before paying. You can go back to change any setting.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Edit settings
        </button>
      </div>

      {/* Shop + location card. */}
      <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-tint)]">
            <Store className="size-5 text-[var(--accent)]" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold text-[var(--label)]">{shopName}</p>
            <p className="mt-0.5 text-[13px] text-[var(--label-2)]">
              {readyFiles.length} {readyFiles.length === 1 ? 'document' : 'documents'} ·{' '}
              {readyFiles.reduce((s, f) => s + (f.pageCount ?? 0) * f.settings.copies, 0)} pages total
            </p>
          </div>
          <span className={[
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
            shop.isOpen
              ? 'bg-[var(--success-tint)] text-[var(--success-text)]'
              : 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
          ].join(' ')}>
            <span className={[
              'size-1.5 rounded-full',
              shop.isOpen ? 'bg-[var(--success)]' : 'bg-[var(--warning)]',
            ].join(' ')} aria-hidden="true" />
            {shop.isOpen ? 'Open' : 'Closed'}
          </span>
        </div>
      </div>

      {/* Document cards. */}
      {readyFiles.map((file, i) => {
        const s = file.settings;
        const pageCount = file.pageCount ?? 0;
        const bwPages = s.mode === 'colour'
          ? []
          : s.mode === 'mixed'
            ? Array.from({ length: pageCount }, (_, k) => k + 1)
                .filter((p) => !s.colourPages.includes(p) && !s.skipPages.includes(p))
            : Array.from({ length: pageCount }, (_, k) => k + 1).filter((p) => !s.skipPages.includes(p));
        return (
          <div key={file.id} className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
            {/* Header row: thumbnail + name + page count. */}
            <div className="flex items-start gap-3">
              {file.thumbnails[0] ? (
                <img src={file.thumbnails[0].url} alt={file.name} className="size-14 shrink-0 rounded-[8px] border border-[var(--hairline)] object-cover" />
              ) : (
                <div className="flex size-14 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ground)]">
                  <FileText className="size-6 text-[var(--accent)]" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[15px] font-semibold text-[var(--label)]">{file.name}</p>
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">
                    Doc {i + 1}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] text-[var(--label-2)]">
                  {pageCount} pages · {formatSize(file.sizeBytes)}
                </p>
              </div>
            </div>

            {/* Settings grid — mode, copies, paper, sides. */}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Mode</dt>
                <dd className="font-semibold text-[var(--label)]">{modeLabel(s)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Copies</dt>
                <dd className="font-semibold text-[var(--label)]">{s.copies}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Paper</dt>
                <dd className="font-semibold text-[var(--label)]">{s.paperSize}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Sides</dt>
                <dd className="font-semibold text-[var(--label)]">{s.sides === 'SINGLE' ? 'Single' : 'Double'}</dd>
              </div>
              {s.pagesPerSheet > 1 && (
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Per sheet</dt>
                  <dd className="font-semibold text-[var(--label)]">{s.pagesPerSheet}</dd>
                </div>
              )}
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Paper type</dt>
                <dd className="font-semibold text-[var(--label)]">{s.paperType}</dd>
              </div>
            </dl>

            {/* Page-range breakdown for mixed / colour / skip modes. */}
            {(s.mode === 'mixed' || s.mode === 'colour' || s.skipPages.length > 0) && (
              <div className="mt-3 rounded-[8px] bg-[var(--ground)] p-3 text-[12px]">
                {s.mode === 'colour' && (
                  <p className="text-[var(--label-2)]">
                    <span className="font-semibold text-[var(--accent-tint-text)]">Colour:</span> All {pageCount} pages
                  </p>
                )}
                {s.mode === 'mixed' && (
                  <>
                    <p className="text-[var(--label-2)]">
                      <span className="font-semibold text-[var(--accent-tint-text)]">Colour pages:</span> {formatRanges(s.colourPages)}
                    </p>
                    <p className="mt-1 text-[var(--label-2)]">
                      <span className="font-semibold text-[var(--label)]">B&W pages:</span> {formatRanges(bwPages)}
                    </p>
                  </>
                )}
                {s.mode === 'bw' && (
                  <p className="text-[var(--label-2)]">
                    <span className="font-semibold text-[var(--label)]">B&W pages:</span> {formatRanges(bwPages)}
                  </p>
                )}
                {s.skipPages.length > 0 && (
                  <p className="mt-1 text-[var(--label-2)]">
                    <span className="font-semibold text-[#DC2626]">Skip pages:</span> {formatRanges(s.skipPages)}
                  </p>
                )}
              </div>
            )}

            {/* Thumbnail strip (first 8) — visual at-a-glance. */}
            {file.thumbnails.length > 0 && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                {file.thumbnails.slice(0, 8).map((t) => {
                  const isColour = s.mode === 'colour' || (s.mode === 'mixed' && s.colourPages.includes(t.page));
                  const isSkip = s.skipPages.includes(t.page);
                  return (
                    <div key={t.page} className="relative shrink-0">
                      <img
                        src={t.url}
                        alt={`Page ${t.page}`}
                        className={[
                          'size-12 rounded-[4px] border object-cover',
                          isSkip ? 'border-[var(--label-3)] opacity-40' : isColour ? 'border-[var(--accent)]' : 'border-[var(--hairline)]',
                        ].join(' ')}
                      />
                      {isColour && <span className="absolute right-0 top-0 size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />}
                    </div>
                  );
                })}
                {file.thumbnails.length > 8 && (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-[4px] border border-[var(--hairline)] bg-[var(--ground)] text-[10px] font-semibold text-[var(--label-2)]">
                    +{file.thumbnails.length - 8}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Price breakdown card — from the server-authoritative quote. */}
      <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[var(--label)]">
          <Receipt className="size-4 text-[var(--accent)]" aria-hidden="true" />
          Price breakdown
        </h2>

        {quote == null ? (
          <p className="mt-3 text-[13px] text-[var(--label-2)]">
            Add at least one document to see pricing.
          </p>
        ) : (
          <>
            {/* Line items. */}
            {quote.lines.length > 0 && (
              <div className="mt-4 border-t border-[var(--hairline)] pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-3)]">Printing charges</p>
                <ul className="mt-2 space-y-1.5">
                  {quote.lines.map((line, i) => (
                    <li key={i} className="flex items-center justify-between text-[13px]">
                      <span className="text-[var(--label-2)]">
                        {line.colorMode === 'COLOR' ? 'Colour' : 'B&W'} · {line.pages}p × {line.copies} · {line.paperSize}
                      </span>
                      <span className="font-medium text-[var(--label)]">{formatRupees(line.linePaise)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Add-ons. */}
            {quote.addonsDetail.length > 0 && (
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

            {/* Urgent surcharge. */}
            {quote.urgentPaise > 0 && (
              <div className="mt-3 flex items-center justify-between text-[13px]">
                <span className="text-[var(--label-2)]">Urgent surcharge</span>
                <span className="font-medium text-[var(--label)]">{formatRupees(quote.urgentPaise)}</span>
              </div>
            )}

            {/* Total. */}
            <div className="mt-4 border-t border-[var(--hairline)] pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[var(--label)]">Total</span>
                <span className="text-[22px] font-bold text-[var(--accent)]">{formatRupees(quote.totalPaise)}</span>
              </div>
              {(quote.ruleMissing || (quote.warnings?.length ?? 0) > 0) && (
                <p className="mt-2 rounded-[8px] bg-[var(--warning-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--warning)]">
                  Estimated price — some pricing rules are missing. Final amount is confirmed at checkout.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Customer details — preserved from the prior flow so the orchestrator
          can validate the phone before allowing `onProceed`. */}
      {(onCustomerName || onCustomerPhone || onNote) && (
        <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--label)]">
            <User className="size-4 text-[var(--accent)]" aria-hidden="true" />
            Your contact details
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--label-2)]">
            So the shop can send you order updates.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[13px] font-semibold text-[var(--label)]" htmlFor="preview-name">Name</label>
              <input
                id="preview-name"
                type="text"
                value={customerName ?? ''}
                onChange={(e) => onCustomerName?.(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="mt-1 h-11 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
            </div>
            <div>
              <label className="text-[13px] font-semibold text-[var(--label)]" htmlFor="preview-phone">
                Phone <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="preview-phone"
                type="tel"
                value={customerPhone ?? ''}
                onChange={(e) => onCustomerPhone?.(e.target.value)}
                placeholder="98765 43210"
                autoComplete="tel"
                inputMode="tel"
                className="mt-1 h-11 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
              {(customerPhone ?? '').replace(/\D/g, '').length > 0 && !phoneValid && (
                <p className="mt-1 text-[11px] text-[#DC2626]">Enter a valid 10-digit mobile number.</p>
              )}
            </div>
          </div>
          {onNote && (
            <div className="mt-3">
              <label className="text-[13px] font-semibold text-[var(--label)]" htmlFor="preview-note">
                <span className="inline-flex items-center gap-1.5">
                  <MessageSquare className="size-3.5" aria-hidden="true" />
                  Note to shop (optional)
                </span>
              </label>
              <textarea
                id="preview-note"
                value={note ?? ''}
                onChange={(e) => onNote?.(e.target.value)}
                placeholder="Any special instructions for the shopkeeper"
                rows={2}
                className="mt-1 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
            </div>
          )}
        </div>
      )}

      {/* Warning banner / proceed button. */}
      {quoteMissingRule || quoteNoTotal ? (
        <div className="rounded-[14px] border border-[#FCD34D]/60 bg-[#FFFBEB] p-4 sm:p-5" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#D97706]" aria-hidden="true" />
            <div>
              <p className="text-[15px] font-semibold text-[#92400E]">
                Pricing not available for these settings
              </p>
              <p className="mt-1 text-[13px] text-[#78350F]">
                The shop hasn't published a price rule that covers one or more of your selected print modes.
                Go back to <button type="button" onClick={onBack} className="font-semibold underline">print settings</button> and pick a different mode, or contact the shop directly.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Navigation: Edit (left) + Proceed (right). */}
      <div className="flex items-center justify-between border-t border-[var(--hairline)] pt-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to settings
        </button>
        {quoteReady ? (
          <PrimaryButton
            type="button"
            disabled={!canProceed}
            onClick={onProceed}
            trailingIcon={<ArrowRight className="size-4" aria-hidden="true" />}
          >
            {proceedLabel}
          </PrimaryButton>
        ) : (
          <span className="inline-flex min-h-[44px] cursor-not-allowed items-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[14px] font-semibold text-white opacity-50">
            <Layers className="size-4" aria-hidden="true" />
            Proceed to payment
          </span>
        )}
      </div>

      {/* Mobile-only sticky bottom bar — total + Proceed. */}
      {quoteReady && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline)] bg-[var(--surface)]/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
          <div className="mx-auto flex max-w-[640px] items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-[var(--label-2)]">
                {readyFiles.length} {readyFiles.length === 1 ? 'document' : 'documents'} · {readyFiles.reduce((s, f) => s + (f.pageCount ?? 0) * f.settings.copies, 0)} pages
              </p>
              <p className="text-[17px] font-bold leading-tight text-[var(--label)]">
                {formatRupees(quote!.totalPaise)}
              </p>
            </div>
            <PrimaryButton
              type="button"
              disabled={!canProceed}
              onClick={onProceed}
              className="shrink-0"
              leadingIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}
            >
              Proceed
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

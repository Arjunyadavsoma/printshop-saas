'use client';

import { ArrowLeft, ArrowRight, FileText, Eye, Check } from 'lucide-react';
import type { StudioFile, ShopCapabilities, PrintSettings } from '../types';
import { formatSize, formatRupees } from '../types';

/**
 * Step 3 — Preview & Review.
 *
 * Shows each file with its configured settings, page count, mode, copies,
 * and a thumbnail preview (where available). For Mixed mode, shows the first
 * five colour + B&W page numbers. The customer can return to previous steps
 * to modify settings (progress is preserved in the orchestrator state).
 *
 * Also collects the customer contact details (name + phone) required for
 * order placement and the shop to send updates.
 */
export function StepPreview({
  files, shop, onBack, onNext, canNext,
  customerName, customerPhone, onCustomerName, onCustomerPhone,
  note, onNote,
}: {
  files: StudioFile[];
  shop: ShopCapabilities;
  onBack: () => void;
  onNext: () => void;
  canNext: boolean;
  customerName: string;
  customerPhone: string;
  onCustomerName: (v: string) => void;
  onCustomerPhone: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
}) {
  const readyFiles = files.filter((f) => f.status === 'ready' && f.pageCount);

  const modeLabel = (s: PrintSettings) => {
    if (s.mode === 'colour') return 'Colour';
    if (s.mode === 'mixed') return `Mixed (${s.colourPages.length} colour)`;
    return 'B&W';
  };

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--label)]">Review your order</h1>
        <p className="mt-1 text-[14px] text-[var(--label-2)]">Check everything before paying. You can go back to change any setting.</p>
      </div>

      {/* Document cards */}
      {readyFiles.map((file) => {
        const s = file.settings;
        const colourPreview = s.mode === 'mixed' ? s.colourPages.slice(0, 5) : [];
        const bwPreview = s.mode === 'mixed'
          ? Array.from({ length: file.pageCount! }, (_, i) => i + 1).filter((p) => !s.colourPages.includes(p) && !s.skipPages.includes(p)).slice(0, 5)
          : [];
        return (
          <div key={file.id} className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-4">
            <div className="flex items-start gap-3">
              {file.thumbnails[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- presigned thumbnail
                <img src={file.thumbnails[0].url} alt={file.name} className="size-14 rounded-[6px] border border-[var(--hairline)] object-cover" />
              ) : (
                <div className="flex size-14 items-center justify-center rounded-[6px] bg-[var(--ground)]"><FileText className="size-6 text-[var(--accent)]" /></div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-[var(--label)]">{file.name}</p>
                <p className="mt-0.5 text-[13px] text-[var(--label-2)]">{file.pageCount} pages · {formatSize(file.sizeBytes)}</p>
              </div>
            </div>

            {/* Settings grid */}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
              <div><dt className="text-[var(--label-3)]">Mode</dt><dd className="font-semibold text-[var(--label)]">{modeLabel(s)}</dd></div>
              <div><dt className="text-[var(--label-3)]">Copies</dt><dd className="font-semibold text-[var(--label)]">{s.copies}</dd></div>
              <div><dt className="text-[var(--label-3)]">Paper</dt><dd className="font-semibold text-[var(--label)]">{s.paperSize}</dd></div>
              <div><dt className="text-[var(--label-3)]">Sides</dt><dd className="font-semibold text-[var(--label)]">{s.sides === 'SINGLE' ? 'Single' : 'Double'}</dd></div>
              {s.pagesPerSheet > 1 && <div><dt className="text-[var(--label-3)]">Per sheet</dt><dd className="font-semibold text-[var(--label)]">{s.pagesPerSheet}</dd></div>}
            </dl>

            {/* Mixed page preview */}
            {s.mode === 'mixed' && (
              <div className="mt-3 rounded-[8px] bg-[var(--ground)] p-3 text-[12px]">
                {colourPreview.length > 0 && (
                  <p className="text-[var(--label-2)]">
                    <span className="font-semibold text-[var(--accent-tint-text)]">Colour:</span> {colourPreview.join(', ')}{s.colourPages.length > 5 ? ` +${s.colourPages.length - 5} more` : ''}
                  </p>
                )}
                {bwPreview.length > 0 && (
                  <p className="mt-1 text-[var(--label-2)]">
                    <span className="font-semibold text-[var(--label)]">B&W:</span> {bwPreview.join(', ')}{(file.pageCount! - s.colourPages.length - s.skipPages.length) > 5 ? ` +${(file.pageCount! - s.colourPages.length - s.skipPages.length) - 5} more` : ''}
                  </p>
                )}
                {s.skipPages.length > 0 && (
                  <p className="mt-1 text-[var(--label-2)]">
                    <span className="font-semibold text-[#DC2626]">Skip:</span> {s.skipPages.slice(0, 5).join(', ')}{s.skipPages.length > 5 ? ` +${s.skipPages.length - 5} more` : ''}
                  </p>
                )}
              </div>
            )}

            {/* Thumbnail strip (first 8) */}
            {file.thumbnails.length > 0 && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                {file.thumbnails.slice(0, 8).map((t) => {
                  const isColour = s.mode === 'colour' || (s.mode === 'mixed' && s.colourPages.includes(t.page));
                  const isSkip = s.skipPages.includes(t.page);
                  return (
                    <div key={t.page} className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- presigned thumbnail */}
                      <img src={t.url} alt={`Page ${t.page}`} className={['size-12 rounded-[4px] border object-cover', isSkip ? 'border-[var(--label-3)] opacity-40' : isColour ? 'border-[var(--accent)]' : 'border-[var(--hairline)]'].join(' ')} />
                      {isColour && <span className="absolute right-0 top-0 size-1.5 rounded-full bg-[var(--accent)]" />}
                    </div>
                  );
                })}
                {file.thumbnails.length > 8 && (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-[4px] border border-[var(--hairline)] bg-[var(--ground)] text-[10px] font-semibold text-[var(--label-2)]">+{file.thumbnails.length - 8}</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Customer details */}
      <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--label)]">Your contact details</h2>
        <p className="mt-0.5 text-[13px] text-[var(--label-2)]">So the shop can send you order updates.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[13px] font-semibold text-[var(--label)]">Name</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => onCustomerName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className="mt-1 h-11 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>
          <div>
            <label className="text-[13px] font-semibold text-[var(--label)]">Phone <span className="text-[#DC2626]">*</span></label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => onCustomerPhone(e.target.value)}
              placeholder="98765 43210"
              autoComplete="tel"
              inputMode="tel"
              className="mt-1 h-11 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
            {customerPhone.replace(/\D/g, '').length > 0 && customerPhone.replace(/\D/g, '').length < 10 && (
              <p className="mt-1 text-[11px] text-[#DC2626]">Enter a valid 10-digit mobile number.</p>
            )}
          </div>
        </div>
        <div className="mt-3">
          <label className="text-[13px] font-semibold text-[var(--label)]">Note to shop (optional)</label>
          <textarea
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Any special instructions for the shopkeeper"
            rows={2}
            className="mt-1 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          />
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-[var(--hairline)] pt-4">
        <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]">
          <ArrowLeft className="size-4" /> Back to settings
        </button>
        <button type="button" onClick={onNext} disabled={!canNext} className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50">
          Proceed to pay <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

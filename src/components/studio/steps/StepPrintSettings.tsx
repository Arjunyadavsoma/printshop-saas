'use client';

import { useState, useMemo } from 'react';
import {
  ArrowLeft, ArrowRight, Copy, RotateCcw, Layers, AlertCircle, Eye,
} from 'lucide-react';
import type { StudioFile, ShopCapabilities, PrintSettings, PrintMode, UiPageMode } from '../types';
import { formatSize } from '../types';

/**
 * Step 2 — Select Print Settings.
 *
 * Every file has INDEPENDENT print settings:
 *   - Print mode: B&W / Colour / Mixed
 *   - For Mixed: a range input to assign specific pages to colour vs B&W
 *   - Copies, paper size, single/double-sided, pages per sheet, paper type
 *
 * Only options the selected shop supports are shown (colour hidden if the
 * shop has no colour printer, duplex hidden if no duplex printer, paper
 * sizes limited to the shop's configured list).
 *
 * Bulk actions: Apply settings to all files, Copy settings, Reset.
 */

/** Parse a page-range string like "1-5, 8, 12-15" into a sorted unique number[]. */
function parseRanges(input: string, maxPage: number): { pages: number[]; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { pages: [], error: null };
  const result = new Set<number>();
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo > hi) return { pages: [], error: `Range "${part}" is backwards (start > end).` };
      if (hi > maxPage) return { pages: [], error: `Page ${hi} doesn't exist (document has ${maxPage} pages).` };
      if (lo < 1) return { pages: [], error: `Page numbers start at 1.` };
      for (let p = lo; p <= hi; p++) result.add(p);
      continue;
    }
    const singleMatch = part.match(/^(\d+)$/);
    if (singleMatch) {
      const p = parseInt(singleMatch[1], 10);
      if (p < 1) return { pages: [], error: `Page numbers start at 1.` };
      if (p > maxPage) return { pages: [], error: `Page ${p} doesn't exist (document has ${maxPage} pages).` };
      result.add(p);
      continue;
    }
    return { pages: [], error: `"${part}" isn't a valid page number or range. Use the format 1-5, 8, 12-15.` };
  }
  return { pages: Array.from(result).sort((a, b) => a - b), error: null };
}

/** Format a number[] back into a compact range string. */
function formatRanges(pages: number[]): string {
  if (pages.length === 0) return '';
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

export function StepPrintSettings({
  files, shop, onPatchSettings, onApplyToAll, onBack, onNext, canNext,
}: {
  files: StudioFile[];
  shop: ShopCapabilities;
  onPatchSettings: (id: string, patch: Partial<PrintSettings>) => void;
  onApplyToAll: (settings: Partial<PrintSettings>) => void;
  onBack: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  const readyFiles = files.filter((f) => f.status === 'ready' && f.pageCount);
  const [activeId, setActiveId] = useState<string | null>(readyFiles[0]?.id ?? null);
  const [showPreview, setShowPreview] = useState(false);

  const active = readyFiles.find((f) => f.id === activeId) ?? readyFiles[0];

  if (!active) {
    return (
      <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-8 text-center">
        <p className="text-[15px] font-semibold text-[var(--label)]">No ready documents</p>
        <p className="mt-1 text-[14px] text-[var(--label-2)]">Go back and upload at least one file.</p>
        <button onClick={onBack} className="mt-4 inline-flex min-h-[44px] items-center rounded-[10px] bg-[var(--accent)] px-6 text-[14px] font-semibold text-white">Back to upload</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--label)]">Print settings</h1>
          <p className="mt-1 text-[14px] text-[var(--label-2)]">Configure each document independently.</p>
        </div>
      </div>

      {/* File tabs */}
      {readyFiles.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {readyFiles.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setActiveId(f.id)}
              className={[
                'whitespace-nowrap rounded-[10px] border px-3 py-2 text-[13px] font-semibold transition-colors',
                f.id === active.id
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-tint-text)]'
                  : 'border-[var(--hairline)] bg-[var(--surface)] text-[var(--label-2)] hover:bg-[var(--ground)]',
              ].join(' ')}
            >
              {f.name.length > 24 ? f.name.slice(0, 22) + '…' : f.name}
            </button>
          ))}
        </div>
      )}

      {/* Active file settings */}
      <FileSettings
        key={active.id}
        file={active}
        shop={shop}
        onPatch={(patch) => onPatchSettings(active.id, patch)}
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview((v) => !v)}
      />

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onApplyToAll({ mode: active.settings.mode, copies: active.settings.copies, sides: active.settings.sides, paperSize: active.settings.paperSize, pagesPerSheet: active.settings.pagesPerSheet, paperType: active.settings.paperType })}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[13px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
        >
          <Copy className="size-3.5" /> Apply to all files
        </button>
        <button
          type="button"
          onClick={() => onPatchSettings(active.id, { mode: 'bw', copies: 1, sides: 'SINGLE', pagesPerSheet: 1, paperSize: shop.paperSizes[0] ?? 'A4', paperType: 'PLAIN', colourPages: [], skipPages: [] })}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[13px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
        >
          <RotateCcw className="size-3.5" /> Reset this file
        </button>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-[var(--hairline)] pt-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50"
        >
          Review order <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ── Per-file settings panel ──────────────────────────────────────────── */
function FileSettings({
  file, shop, onPatch, showPreview, onTogglePreview,
}: {
  file: StudioFile;
  shop: ShopCapabilities;
  onPatch: (patch: Partial<PrintSettings>) => void;
  showPreview: boolean;
  onTogglePreview: () => void;
}) {
  const s = file.settings;
  const pageCount = file.pageCount ?? 0;
  const [colourInput, setColourInput] = useState(formatRanges(s.colourPages));
  const [colourError, setColourError] = useState<string | null>(null);
  const [bwInput, setBwInput] = useState(formatRanges(s.skipPages));
  const [bwError, setBwError] = useState<string | null>(null);

  const modes: { value: PrintMode; label: string; desc: string; disabled?: boolean }[] = [
    { value: 'bw', label: 'Black & White', desc: 'All pages in B&W' },
    { value: 'colour', label: 'Colour', desc: 'All pages in colour', disabled: !shop.supportsColor },
    { value: 'mixed', label: 'Mixed', desc: 'Pick colour pages', disabled: !shop.supportsColor },
  ];

  const commitColour = () => {
    const { pages, error } = parseRanges(colourInput, pageCount);
    if (error) { setColourError(error); return; }
    // Check overlap with skip pages
    const skipSet = new Set(s.skipPages);
    const overlap = pages.filter((p) => skipSet.has(p));
    if (overlap.length > 0) { setColourError(`Pages ${formatRanges(overlap)} are marked to skip — remove them from skip first.`); return; }
    setColourError(null);
    onPatch({ colourPages: pages });
  };

  const commitBw = () => {
    const { pages, error } = parseRanges(bwInput, pageCount);
    if (error) { setBwError(error); return; }
    const colourSet = new Set(s.colourPages);
    const overlap = pages.filter((p) => colourSet.has(p));
    if (overlap.length > 0) { setBwError(`Pages ${formatRanges(overlap)} are marked for colour — remove them from colour first.`); return; }
    setBwError(null);
    onPatch({ skipPages: pages });
  };

  const assignedPages = s.colourPages.length + s.skipPages.length;
  const unassignedPages = pageCount - assignedPages;

  return (
    <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
      {/* File header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold text-[var(--label)]">{file.name}</p>
          <p className="mt-0.5 text-[13px] text-[var(--label-2)]">{pageCount} pages · {formatSize(file.sizeBytes)}</p>
        </div>
        {file.thumbnails.length > 0 && (
          <button
            type="button"
            onClick={onTogglePreview}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[8px] border border-[var(--hairline)] px-3 text-[13px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
          >
            <Eye className="size-3.5" /> {showPreview ? 'Hide pages' : 'Preview pages'}
          </button>
        )}
      </div>

      {/* Page preview thumbnails (toggle) */}
      {showPreview && file.thumbnails.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-2 rounded-[10px] bg-[var(--ground)] p-3 sm:grid-cols-6">
          {file.thumbnails.slice(0, 24).map((t) => {
            const isColour = s.mode === 'colour' || (s.mode === 'mixed' && s.colourPages.includes(t.page));
            const isSkip = s.skipPages.includes(t.page);
            return (
              <div key={t.page} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- presigned thumbnail URL */}
                <img src={t.url} alt={`Page ${t.page}`} className={['aspect-[3/4] w-full rounded-[4px] border-2 object-cover', isSkip ? 'border-[var(--label-3)] opacity-40' : isColour ? 'border-[var(--accent)]' : 'border-[var(--hairline)]'].join(' ')} />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-white/90 px-1 text-[9px] font-semibold text-[var(--label)]">{t.page}</span>
                {isColour && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-[var(--accent)]" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Print mode selector */}
      <div className="mt-5">
        <p className="text-[13px] font-semibold text-[var(--label)]">Print mode</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {modes.map((m) => (
            <button
              key={m.value}
              type="button"
              disabled={m.disabled}
              onClick={() => onPatch({ mode: m.value, colourPages: m.value === 'colour' ? Array.from({ length: pageCount }, (_, i) => i + 1) : m.value === 'bw' ? [] : s.colourPages })}
              className={[
                'flex flex-col items-start rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                s.mode === m.value
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                  : 'border-[var(--hairline)] bg-[var(--surface)] hover:bg-[var(--ground)]',
                m.disabled ? 'opacity-40' : '',
              ].join(' ')}
            >
              <span className={['text-[14px] font-semibold', s.mode === m.value ? 'text-[var(--accent-tint-text)]' : 'text-[var(--label)]'].join(' ')}>{m.label}</span>
              <span className="mt-0.5 text-[11px] text-[var(--label-2)]">{m.desc}</span>
            </button>
          ))}
        </div>
        {!shop.supportsColor && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--label-2)]">
            <AlertCircle className="size-3.5" /> This shop doesn't offer colour printing.
          </p>
        )}
      </div>

      {/* Mixed mode: page range inputs */}
      {s.mode === 'mixed' && (
        <div className="mt-4 rounded-[10px] border border-[var(--hairline)] bg-[var(--ground)] p-4">
          <p className="text-[13px] font-semibold text-[var(--label)]">Assign pages to colour or B&W</p>
          <p className="mt-0.5 text-[12px] text-[var(--label-2)]">
            Use ranges like <span className="font-mono">1-5, 8, 12-15</span>. {pageCount} pages total.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {/* Colour pages */}
            <div>
              <label className="text-[12px] font-semibold text-[var(--accent-tint-text)]">Colour pages</label>
              <input
                type="text"
                value={colourInput}
                onChange={(e) => setColourInput(e.target.value)}
                onBlur={commitColour}
                placeholder="e.g. 1-5, 8, 12-15"
                className={['mt-1 h-11 w-full rounded-[8px] border bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30', colourError ? 'border-[#DC2626]' : 'border-[var(--hairline)] focus:border-[var(--accent)]'].join(' ')}
                inputMode="numeric"
              />
              {colourError ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-[#DC2626]"><AlertCircle className="size-3" /> {colourError}</p>
              ) : (
                <p className="mt-1 text-[11px] text-[var(--label-2)]">{s.colourPages.length} page(s) selected for colour</p>
              )}
            </div>
            {/* Skip pages */}
            <div>
              <label className="text-[12px] font-semibold text-[var(--label-2)]">Skip pages (optional)</label>
              <input
                type="text"
                value={bwInput}
                onChange={(e) => setBwInput(e.target.value)}
                onBlur={commitBw}
                placeholder="e.g. 6-7"
                className={['mt-1 h-11 w-full rounded-[8px] border bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30', bwError ? 'border-[#DC2626]' : 'border-[var(--hairline)] focus:border-[var(--accent)]'].join(' ')}
                inputMode="numeric"
              />
              {bwError ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-[#DC2626]"><AlertCircle className="size-3" /> {bwError}</p>
              ) : (
                <p className="mt-1 text-[11px] text-[var(--label-2)]">{s.skipPages.length} page(s) will be skipped</p>
              )}
            </div>
          </div>

          {/* Assignment summary */}
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium">
            <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[var(--accent-tint-text)]">{s.colourPages.length} colour</span>
            <span className="rounded-full bg-[var(--ground)] px-2 py-0.5 text-[var(--label-2)] border border-[var(--hairline)]">{unassignedPages} B&W</span>
            {s.skipPages.length > 0 && <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[#DC2626]">{s.skipPages.length} skip</span>}
          </div>

          {/* Quick fill buttons */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { const all = Array.from({ length: pageCount }, (_, i) => i + 1); setColourInput(formatRanges(all)); onPatch({ colourPages: all }); }} className="rounded-[6px] border border-[var(--hairline)] px-2 py-1 text-[11px] font-semibold text-[var(--label)] hover:bg-[var(--surface)]">All colour</button>
            <button type="button" onClick={() => { setColourInput(''); onPatch({ colourPages: [] }); }} className="rounded-[6px] border border-[var(--hairline)] px-2 py-1 text-[11px] font-semibold text-[var(--label)] hover:bg-[var(--surface)]">Clear colour</button>
            {file.colorSuggestion && file.colorSuggestion.length > 0 && (
              <button type="button" onClick={() => { const suggested = file.colorSuggestion!.filter((c) => c.isColor).map((c) => c.page); setColourInput(formatRanges(suggested)); onPatch({ colourPages: suggested }); }} className="rounded-[6px] bg-[var(--accent-tint)] px-2 py-1 text-[11px] font-semibold text-[var(--accent-tint-text)] hover:bg-[var(--accent-tint)]/80">Use smart suggestion ({file.colorSuggestion.filter((c) => c.isColor).length} detected)</button>
            )}
          </div>
        </div>
      )}

      {/* Additional options */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {/* Copies */}
        <div>
          <label className="text-[13px] font-semibold text-[var(--label)]">Copies</label>
          <div className="mt-1 flex items-center gap-2">
            <button type="button" onClick={() => onPatch({ copies: Math.max(1, s.copies - 1) })} className="size-11 rounded-[8px] border border-[var(--hairline)] text-[18px] font-bold text-[var(--label)] hover:bg-[var(--ground)]" aria-label="Fewer copies">−</button>
            <span className="flex-1 rounded-[8px] border border-[var(--hairline)] bg-[var(--ground)] py-2.5 text-center text-[16px] font-bold text-[var(--label)]">{s.copies}</span>
            <button type="button" onClick={() => onPatch({ copies: Math.min(100, s.copies + 1) })} className="size-11 rounded-[8px] border border-[var(--hairline)] text-[18px] font-bold text-[var(--label)] hover:bg-[var(--ground)]" aria-label="More copies">+</button>
          </div>
        </div>

        {/* Paper size */}
        <div>
          <label className="text-[13px] font-semibold text-[var(--label)]">Paper size</label>
          <select
            value={s.paperSize}
            onChange={(e) => onPatch({ paperSize: e.target.value })}
            className="mt-1 h-11 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          >
            {(shop.paperSizes.length > 0 ? shop.paperSizes : ['A4', 'A3', 'Letter']).map((ps) => (
              <option key={ps} value={ps}>{ps}</option>
            ))}
          </select>
        </div>

        {/* Sides */}
        {shop.supportsDuplex && (
          <div>
            <label className="text-[13px] font-semibold text-[var(--label)]">Sides</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(['SINGLE', 'DOUBLE'] as const).map((side) => (
                <button key={side} type="button" onClick={() => onPatch({ sides: side })} className={['h-11 rounded-[8px] border text-[13px] font-semibold transition-colors', s.sides === side ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-tint-text)]' : 'border-[var(--hairline)] bg-[var(--surface)] text-[var(--label)] hover:bg-[var(--ground)]'].join(' ')}>
                  {side === 'SINGLE' ? 'Single' : 'Double'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pages per sheet */}
        <div>
          <label className="text-[13px] font-semibold text-[var(--label)]">Pages per sheet</label>
          <select
            value={s.pagesPerSheet}
            onChange={(e) => onPatch({ pagesPerSheet: Number(e.target.value) as PrintSettings['pagesPerSheet'] })}
            className="mt-1 h-11 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[14px] text-[var(--label)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          >
            {[1, 2, 4, 6, 9].map((n) => (<option key={n} value={n}>{n} per sheet{n > 1 ? ' (N-up)' : ''}</option>))}
          </select>
        </div>
      </div>
    </div>
  );
}

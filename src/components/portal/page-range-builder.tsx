'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { pagesToRanges, formatRange, parsePageRange } from '@/lib/pricing/page-selection';
import { Plus, X, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

/**
 * Advanced page-range builder with two synchronized tabs:
 *
 * 1. "Add Page Range" — From/To numeric inputs + Add button. Each added
 *    range becomes a removable chip. Multiple ranges are merged into a
 *    single de-duplicated page set.
 * 2. "Manual Input" — Free-text input supporting `1-5,8,12-14` syntax.
 *    Apply replaces the selection.
 *
 * Both tabs share the same `selectedPages` state. Changing one immediately
 * updates the other. The selected-page count and chips are always visible.
 *
 * `selectedPages: null` means "print all pages" (no range). Clearing all
 * ranges resets to this state.
 */
export function PageRangeBuilder({
  pageCount,
  selectedPages,
  disabled,
  onChange,
}: {
  pageCount: number;
  selectedPages: number[] | null;
  disabled: boolean;
  onChange: (selectedPages: number[] | null) => void;
}) {
  const [tab, setTab] = useState<'builder' | 'manual'>('builder');
  const [fromPage, setFromPage] = useState('');
  const [toPage, setToPage] = useState('');
  const [manualText, setManualText] = useState('');
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);

  // Derive range chips from the current selection.
  const ranges = useMemo(
    () => (selectedPages ? pagesToRanges(selectedPages) : []),
    [selectedPages],
  );
  const selectedCount = selectedPages?.length ?? pageCount;
  // "All pages" is active when selectedPages is null OR when the selection
  // happens to include every page (e.g. the user added range 1-N manually).
  // This prevents the "All pages" button from fighting with a full selection.
  const isAllPages = selectedPages === null || (pageCount > 0 && selectedPages.length >= pageCount);

  // ── Add range (builder tab) ──
  const addRange = () => {
    setBuilderError(null);
    if (pageCount <= 0) {
      setBuilderError('Page count is unknown — enter the page count first.');
      return;
    }
    const from = parseInt(fromPage, 10);
    const toRaw = toPage.trim() === '' ? fromPage : toPage;
    const to = parseInt(toRaw, 10);

    if (!Number.isFinite(from) || from < 1 || from > pageCount) {
      setBuilderError(`From page must be between 1 and ${pageCount}.`);
      return;
    }
    if (!Number.isFinite(to) || to < 1 || to > pageCount) {
      setBuilderError(`To page must be between 1 and ${pageCount}.`);
      return;
    }
    if (from > to) {
      setBuilderError('From page cannot be greater than To page.');
      return;
    }

    // Merge with existing selection (de-duplicated via Set).
    const current = new Set(selectedPages ?? []);
    for (let p = from; p <= to; p++) current.add(p);
    onChange(Array.from(current).sort((a, b) => a - b));
    setFromPage('');
    setToPage('');
  };

  // ── Remove a single range chip ──
  const removeRange = (range: { from: number; to: number }) => {
    if (!selectedPages) return;
    const toRemove = new Set<number>();
    for (let p = range.from; p <= range.to; p++) toRemove.add(p);
    const remaining = selectedPages.filter((p) => !toRemove.has(p));
    // If nothing remains, reset to "all pages" (null) — the customer
    // probably wants to print the whole document, not zero pages.
    onChange(remaining.length === 0 ? null : remaining);
  };

  // ── Clear all ranges → print all pages ──
  const clearAll = () => {
    onChange(null);
    setManualText('');
    setBuilderError(null);
    setManualError(null);
    setManualSuccess(null);
  };

  // ── Quick select: odd pages (1, 3, 5, ...) ──
  const selectOdd = () => {
    const odd: number[] = [];
    for (let p = 1; p <= pageCount; p += 2) odd.push(p);
    onChange(odd);
  };

  // ── Quick select: even pages (2, 4, 6, ...) ──
  const selectEven = () => {
    const even: number[] = [];
    for (let p = 2; p <= pageCount; p += 2) even.push(p);
    onChange(even.length > 0 ? even : null);
  };

  // ── Quick select: all pages (null = print all) ──
  const selectAll = () => {
    onChange(null);
  };

  // ─<arg_value>Apply manual input ──
  const applyManual = () => {
    setManualError(null);
    setManualSuccess(null);
    const trimmed = manualText.trim();
    if (trimmed === '') {
      // Empty input = print all pages.
      onChange(null);
      setManualSuccess('Cleared — all pages will be printed.');
      return;
    }
    if (pageCount <= 0) {
      setManualError('Page count is unknown — enter the page count first.');
      return;
    }
    const parsed = parsePageRange(trimmed, pageCount);
    if (!parsed) {
      setManualError(
        `Invalid format. Use "1-5", "1,3,5", or "2-4,8,10-12". Pages must be 1–${pageCount}.`,
      );
      return;
    }
    onChange(parsed);
    setManualSuccess(`${parsed.length} page${parsed.length === 1 ? '' : 's'} selected.`);
  };

  if (disabled) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Page range selection is unavailable until the page count is confirmed.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-foreground">Page range</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {isAllPages
            ? `All ${pageCount} pages`
            : `${selectedCount} of ${pageCount} pages selected`}
        </span>
      </div>

      {/* Quick-select buttons — "All pages" is the default (highlighted). */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant={isAllPages ? 'secondary' : 'outline'}
          size="sm"
          onClick={selectAll}
          className="h-8 gap-1 text-xs"
        >
          {isAllPages && <CheckCircle2 className="h-3 w-3" />}
          All pages
        </Button>
        <Button
          type="button"
          variant={!isAllPages && selectedCount > 0 && selectedPages?.every((p) => p % 2 === 1) ? 'secondary' : 'outline'}
          size="sm"
          onClick={selectOdd}
          className="h-8 text-xs"
        >
          Odd
        </Button>
        <Button
          type="button"
          variant={!isAllPages && selectedCount > 0 && selectedPages?.every((p) => p % 2 === 0) ? 'secondary' : 'outline'}
          size="sm"
          onClick={selectEven}
          className="h-8 text-xs"
        >
          Even
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'builder' | 'manual')}>
        <TabsList className="w-full">
          <TabsTrigger value="builder" className="flex-1">Add Page Range</TabsTrigger>
          <TabsTrigger value="manual" className="flex-1">Manual Input</TabsTrigger>
        </TabsList>

        {/* ── Add Page Range tab ── */}
        <TabsContent value="builder" className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-2">
            <div className="flex-1">
              <Label htmlFor="from-page" className="text-xs text-muted-foreground">From page</Label>
              <Input
                id="from-page"
                type="number"
                min={1}
                max={pageCount}
                inputMode="numeric"
                value={fromPage}
                onChange={(e) => { setFromPage(e.target.value); setBuilderError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addRange(); } }}
                placeholder="1"
                className="mt-1 h-10 tabular-nums"
                aria-label="From page"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="to-page" className="text-xs text-muted-foreground">To page</Label>
              <Input
                id="to-page"
                type="number"
                min={1}
                max={pageCount}
                inputMode="numeric"
                value={toPage}
                onChange={(e) => { setToPage(e.target.value); setBuilderError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addRange(); } }}
                placeholder="5"
                className="mt-1 h-10 tabular-nums"
                aria-label="To page"
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addRange}
              disabled={!fromPage}
              className="h-10 min-h-[44px] gap-1.5 sm:w-auto"
            >
              <Plus className="h-4 w-4" /> Add range
            </Button>
          </div>
          {builderError && (
            <p className="flex items-start gap-1.5 text-xs text-danger" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{builderError}</span>
            </p>
          )}
        </TabsContent>

        {/* ── Manual Input tab ── */}
        <TabsContent value="manual" className="space-y-3">
          <div>
            <Label htmlFor="manual-range" className="text-xs text-muted-foreground">
              Or enter ranges manually
            </Label>
            <Input
              id="manual-range"
              type="text"
              value={manualText}
              onChange={(e) => { setManualText(e.target.value); setManualError(null); setManualSuccess(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyManual(); } }}
              placeholder="e.g. 1-5, 8-12, 15, 20-25"
              className="mt-1 h-10"
              aria-label="Manual page range input"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={applyManual}
            disabled={!manualText.trim() && selectedPages === null}
            className="h-10 min-h-[44px] gap-1.5"
          >
            Apply
          </Button>
          {manualError && (
            <p className="flex items-start gap-1.5 text-xs text-danger" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{manualError}</span>
            </p>
          )}
          {manualSuccess && (
            <p className="flex items-start gap-1.5 text-xs text-success" role="status">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{manualSuccess}</span>
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Selected range chips (visible on both tabs) ── */}
      {ranges.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ranges.map((r, i) => (
              <Badge
                key={`${r.from}-${r.to}-${i}`}
                variant="outline"
                className="gap-1 py-1 pl-2 pr-1 text-xs tabular-nums"
              >
                {formatRange(r)}
                <button
                  type="button"
                  onClick={() => removeRange(r)}
                  className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-danger"
                  aria-label={`Remove range ${formatRange(r)}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums text-muted-foreground">
              {selectedCount} page{selectedCount === 1 ? '' : 's'} selected
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-danger"
            >
              <Trash2 className="h-3 w-3" /> Clear all
            </Button>
          </div>
        </div>
      ) : (
        !isAllPages && (
          <p className="text-xs text-muted-foreground">No pages selected.</p>
        )
      )}
    </div>
  );
}

'use client';

import { useMemo, type ReactNode } from 'react';
import { type PageMode } from './tokens';
import { PageThumb } from './page-thumb';

/**
 * PageStrip — the grid of PageThumbs that lets the customer pick a colour
 * mode for every page of every uploaded file.
 *
 * This is THE signature element of the redesign. It is the moment the
 * customer understands the product: "I can pay for colour on exactly the
 * pages I want." Every other screen orbits this one.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ 12 B&W · 3 Colour · 2 skip            (totals)│
 *   │ ┌──┐ ┌──┐ ┌──┐ ┌──┐                          │
 *   │ │  │ │  │ │  │ │  │   3-col grid (360px)    │
 *   │ └──┘ └──┘ └──┘ └──┘   → 4-col on wider       │
 *   │  ...                                         │
 *   │ Double-sided saves ₹12      (optional nudge) │
 *   │ [All B&W] [All Colour] [Use suggestion]      │
 *   └──────────────────────────────────────────────┘
 *
 * Virtualization for 500-page PDFs: each cell carries
 * `content-visibility: auto` with a `contain-intrinsic-size` matching the
 * aspect-[3/4] thumb, so off-screen cells cost nothing to render. This is
 * simpler than an IntersectionObserver-based windowing scheme and works
 * without a measurement pass — the browser skips layout/paint for cells
 * outside the viewport.
 *
 * Totals use tabular nums and the muted text colour — they're reference
 * info, not the focus. The bulk-action buttons are 48px touch targets and
 * span full-width on narrow viewports so the customer can act on the whole
 * grid without scrolling.
 */

export interface PageStripPage {
  pageNumber: number;
  mode: PageMode;
}

export interface PageStripProps {
  pages: PageStripPage[];
  onToggle: (pageNumber: number) => void;
  /** Bulk-set every page to one mode (the "All B&W" / "All Colour" buttons). */
  onBulkSet: (mode: PageMode) => void;
  /** When true, the "Use suggestion" button renders. */
  suggestionAvailable?: boolean;
  /** Click handler for the suggestion button. */
  onUseSuggestion?: () => void;
  /** Pages currently in the multi-select set (rings those thumbs). */
  selectedPages?: Set<number>;
  /** Long-press on a thumb — parent decides what to do (open the sheet). */
  onLongPress?: (pageNumber: number) => void;
  /** Optional money nudge line — only shown if provided. */
  moneyNudge?: string;
  className?: string;
}

const MODE_COUNT_LABEL: Record<PageMode, string> = {
  bw: 'B&W',
  colour: 'Colour',
  skip: 'skip',
};

/**
 * Count the pages per mode. We walk the array once and total into a record.
 * Used for the running-totals line at the top of the strip.
 */
function countModes(pages: PageStripPage[]): Record<PageMode, number> {
  const counts: Record<PageMode, number> = { bw: 0, colour: 0, skip: 0 };
  for (const p of pages) {
    counts[p.mode] += 1;
  }
  return counts;
}

export function PageStrip({
  pages,
  onToggle,
  onBulkSet,
  suggestionAvailable = false,
  onUseSuggestion,
  selectedPages,
  onLongPress,
  moneyNudge,
  className = '',
}: PageStripProps) {
  const counts = useMemo(() => countModes(pages), [pages]);

  // Build the totals string — "12 B&W · 3 Colour · 2 skip". We always show
  // all three counts (even if zero) so the layout is stable as the customer
  // toggles modes; nothing jumps around.
  const totalsLine = [
    `${counts.bw} B&W`,
    `${counts.colour} Colour`,
    `${counts.skip} skip`,
  ].join(' · ');

  return (
    <section
      className={[
        'flex flex-col gap-3',
        'bg-[var(--color-surface)]',
        'rounded-[var(--radius-default)]',
        'border border-[var(--color-border-ink)]',
        'p-4',
        className,
      ].join(' ')}
      aria-label="Page colour mode selection"
    >
      {/* Running totals — tnum, muted. Reference info, not the focus. */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-[var(--color-muted)] tnum">{totalsLine}</p>
        <p className="text-xs text-[var(--color-muted)] tnum">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'}
        </p>
      </div>

      {/* The grid — 3 cols at 360px, 4 cols from sm (≥640px) up. The gap
          is 8px so thumbs sit close enough to read as a sequence but
          separate enough to tap individually. */}
      <div
        role="list"
        aria-label="Pages"
        className="grid grid-cols-3 sm:grid-cols-4 gap-2"
      >
        {pages.map((page) => (
          <div
            role="listitem"
            key={page.pageNumber}
            // content-visibility:auto lets the browser skip layout+paint
            // for off-screen cells. contain-intrinsic-size gives the
            // browser a size hint so the scrollbar doesn't jitter as cells
            // scroll into view. The hint matches the aspect-[3/4] thumb at
            // ~100px wide → ~133px tall (3-col on 360px ≈ 100px + 8px gap).
            style={{
              contentVisibility: 'auto',
              containIntrinsicSize: '120px 160px',
            }}
            className="min-w-0"
          >
            <PageThumb
              pageNumber={page.pageNumber}
              mode={page.mode}
              onToggle={() => onToggle(page.pageNumber)}
              onLongPress={onLongPress ? () => onLongPress(page.pageNumber) : undefined}
              selected={selectedPages?.has(page.pageNumber) ?? false}
            />
          </div>
        ))}
      </div>

      {/* Money nudge — only if the parent passes a string. Sits between
          the grid and the bulk actions so it reads as "before you commit,
          consider this." Muted text, no decoration — quiet persuasion. */}
      {moneyNudge && (
        <p className="text-xs text-[var(--color-success)] tnum text-center">
          {moneyNudge}
        </p>
      )}

      {/* Bulk actions — three buttons, all 48px touch targets. On a 360px
          viewport they stack full-width; on wider screens they sit in a
          row. Order: All B&W, All Colour, Use suggestion. */}
      <BulkActions
        suggestionAvailable={suggestionAvailable}
        onUseSuggestion={onUseSuggestion}
        onBulkSet={onBulkSet}
      />
    </section>
  );
}

/**
 * BulkActions — the three below-grid buttons.
 *
 * Kept as a private component so the layout logic is isolated. Each button
 * is a SecondaryButton-style surface chip: surface bg, ink-strong border,
 * ink text. The "Use suggestion" button gets a subtle cyan-ink tint so it
 * reads as the recommended path without being loud about it.
 */
function BulkActions({
  suggestionAvailable,
  onUseSuggestion,
  onBulkSet,
}: {
  suggestionAvailable: boolean;
  onUseSuggestion?: () => void;
  onBulkSet: (mode: PageMode) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 mt-1">
      <div className="grid grid-cols-2 gap-2">
        <BulkButton onClick={() => onBulkSet('bw')} label="All B&W" />
        <BulkButton onClick={() => onBulkSet('colour')} label="All Colour" />
      </div>
      {suggestionAvailable && onUseSuggestion && (
        <BulkButton
          onClick={onUseSuggestion}
          label="Use suggestion"
          emphasis
          full
        />
      )}
    </div>
  );
}

/**
 * BulkButton — a single bulk-action button.
 *
 * Surface bg, ink border, 48px min-height (touch-target). The `emphasis`
 * variant adds a cyan-ink text colour + a subtle cyan-tinted border so the
 * "Use suggestion" CTA reads as recommended without needing decoration.
 */
function BulkButton({
  onClick,
  label,
  emphasis = false,
  full = false,
}: {
  onClick: () => void;
  label: string;
  emphasis?: boolean;
  full?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'touch-target inline-flex items-center justify-center',
        'px-4 text-sm font-medium',
        'rounded-[var(--radius-default)]',
        'border transition-colors duration-150',
        'active:bg-[var(--color-paper)]',
        full ? 'w-full' : '',
        emphasis
          ? 'border-[var(--color-cyan-ink)]/40 text-[var(--color-cyan-ink)] bg-[var(--color-cyan-ink)]/5'
          : 'border-[var(--color-border-ink-strong)] text-[var(--color-ink)] bg-[var(--color-surface)]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// Re-export for type-only consumers that import from the strip file.
export type { PageMode } from './tokens';

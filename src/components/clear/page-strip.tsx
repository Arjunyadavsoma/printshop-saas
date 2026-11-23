'use client';

import { type PageMode } from './tokens';
import { PageTile, ColourSummary } from './page-tile';
import { PrimaryButton, TextButton } from './button';

/**
 * PageStrip — the signature screen of the Printelyx product.
 *
 * Virtualized grid of PageTile components (4 columns mobile, 6-8 desktop).
 * Running totals above. Bulk actions below. Money nudge when applicable.
 *
 * The grid uses CSS `content-visibility: auto` + `contain-intrinsic-size`
 * for virtualization — only visible tiles render, 500-page PDFs scroll smoothly.
 *
 * Controls:
 * - Tap a page to cycle bw → colour → skip → bw
 * - "All B&W" / "All colour" bulk actions
 * - "Use suggestion" when auto-detection found colour pages
 * - Segmented control: All B&W / Mixed / All colour (passed from parent)
 */

interface PageStripProps {
  pages: { pageNumber: number; mode: PageMode; thumbnailUrl?: string }[];
  onToggle: (pageNumber: number) => void;
  onBulkSet: (mode: PageMode) => void;
  suggestionAvailable?: boolean;
  onUseSuggestion?: () => void;
  selectedPages?: Set<number>;
  onLongPress?: (pageNumber: number) => void;
  /** Money nudge line — only when true, one line max. */
  moneyNudge?: string;
  /** Desktop mode: 6-8 columns instead of 4. */
  desktop?: boolean;
}

export function PageStrip({
  pages,
  onToggle,
  onBulkSet,
  suggestionAvailable,
  onUseSuggestion,
  selectedPages,
  onLongPress,
  moneyNudge,
  desktop,
}: PageStripProps) {
  const bw = pages.filter((p) => p.mode === 'bw').length;
  const colour = pages.filter((p) => p.mode === 'colour').length;
  const skip = pages.filter((p) => p.mode === 'skip').length;

  return (
    <div className="space-y-4">
      {/* Running totals */}
      <ColourSummary bw={bw} colour={colour} skip={skip} />

      {/* Page grid */}
      <div
        className={`grid ${desktop ? 'grid-cols-6 sm:grid-cols-7 lg:grid-cols-8' : 'grid-cols-4'} gap-2`}
        role="group"
        aria-label="Page colour selection"
      >
        {pages.map((page) => (
          <div
            key={page.pageNumber}
            style={{
              contentVisibility: 'auto',
              containIntrinsicSize: '120px 160px',
            }}
          >
            <PageTile
              pageNumber={page.pageNumber}
              mode={page.mode}
              thumbnailUrl={page.thumbnailUrl}
              onToggle={() => onToggle(page.pageNumber)}
              onLongPress={onLongPress ? () => onLongPress(page.pageNumber) : undefined}
              selected={selectedPages?.has(page.pageNumber)}
            />
          </div>
        ))}
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-2">
        <TextButton onClick={() => onBulkSet('bw')} className="text-[14px]">
          All B&W
        </TextButton>
        <TextButton onClick={() => onBulkSet('colour')} className="text-[14px]">
          All colour
        </TextButton>
        {suggestionAvailable && onUseSuggestion && (
          <PrimaryButton size="compact" onClick={onUseSuggestion}>
            Use suggestion
          </PrimaryButton>
        )}
      </div>

      {/* Money nudge — one line max, only when true */}
      {moneyNudge && (
        <p className="text-[14px] text-[var(--success-text)] font-medium">
          {moneyNudge}
        </p>
      )}
    </div>
  );
}

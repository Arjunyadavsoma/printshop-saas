'use client';

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';

/**
 * ColorSuggestionPrompt — the prompt that nudges the customer to accept the
 * server's colour-page detection without manually toggling each page.
 *
 * Renders ABOVE the PageStrip in the Options step. When the file's
 * `colorSuggestion` reports at least one colour page, this card shows:
 *
 *   "{n} pages look colourful.
 *    Print those in colour?
 *    [Accept]  [Customize]"
 *
 * - "Accept"   → caller applies the suggestion: colour pages become
 *   'colour', the rest become 'bw'. The prompt dismisses itself.
 * - "Customize" → caller opens the Mix preset (which renders the PageStrip)
 *   so the customer can pick pages manually. The prompt dismisses itself
 *   and does NOT reappear for this file (the caller tracks dismissal per
 *   fileId in a Set).
 *
 * The prompt is intentionally NOT dismissible via an X button — the only
 * two ways out are Accept or Customize, both of which dismiss it. This is
 * the spec's "don't nag" rule: there's no third "ignore" path that leaves
 * the customer without a decision.
 *
 * Accessibility:
 *   - `role="note"` so screen readers announce it as ancillary.
 *   - `aria-labelledby` links the heading to the section.
 *   - Both buttons are 48px touch targets (`.touch-target`).
 *   - The icon is `aria-hidden` — the heading text is the accessible name.
 *
 * Colour palette: cyan-ink border + 5% cyan tint. Reads as a hint, not an
 * alert (no warning yellow / error red). The Accept button is the primary
 * action (cyan-ink fill); Customize is the secondary surface button.
 */

export interface ColorSuggestion {
  page: number;
  isColor: boolean;
}

export interface ColorSuggestionPromptProps {
  /** The server-detected per-page colour suggestion. */
  suggestion: ColorSuggestion[];
  /** Apply the suggestion: colour pages → 'colour', rest → 'bw'. */
  onAccept: () => void;
  /** Dismiss the prompt + open the page strip for manual selection. */
  onCustomize: () => void;
  /** Optional filename — shown as a muted sub-line under the heading. */
  filename?: string;
}

export function ColorSuggestionPrompt({
  suggestion,
  onAccept,
  onCustomize,
  filename,
}: ColorSuggestionPromptProps) {
  // Count colour pages once — the prompt only renders when there's at least
  // one. The parent's dismissal state controls whether this component mounts
  // at all; we don't duplicate that check here.
  const colorPageCount = useMemo(
    () => suggestion.filter((s) => s.isColor).length,
    [suggestion],
  );

  if (colorPageCount === 0) return null;

  return (
    <section
      className="rounded-[var(--radius-default)] border border-[var(--color-cyan-ink)]/40 bg-[var(--color-cyan-ink)]/5 p-4"
      aria-labelledby="color-suggestion-heading"
      role="note"
    >
      <div className="flex items-start gap-3">
        <Sparkles
          className="size-5 shrink-0 mt-0.5 text-[var(--color-cyan-ink)]"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p
            id="color-suggestion-heading"
            className="text-sm font-medium text-[var(--color-ink)]"
          >
            {colorPageCount} {colorPageCount === 1 ? 'page looks' : 'pages look'} colourful.
          </p>
          {filename ? (
            <p className="mt-0.5 text-xs text-[var(--color-muted)] truncate">
              In {filename}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Print those in colour?
          </p>

          {/* Two-button row: Accept (primary) + Customize (secondary).
              Stacks full-width on narrow viewports, sits side-by-side ≥sm. */}
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={onAccept}
              className="touch-target inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] text-white font-medium text-sm hover:bg-[var(--color-cyan-ink)]/90 active:bg-[var(--color-cyan-ink)]/80 transition-colors"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={onCustomize}
              className="touch-target inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-[var(--radius-default)] bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-border-ink)] font-medium text-sm hover:bg-[var(--color-paper)] active:bg-[var(--color-paper)] transition-colors"
            >
              Customize
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

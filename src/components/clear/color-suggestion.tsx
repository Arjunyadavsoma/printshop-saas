'use client';

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { PrimaryButton, TintedButton } from './button';

/**
 * Clear design system — colour suggestion prompt.
 *
 * Renders ABOVE the PageStrip in the Options step when the file's
 * `colorSuggestion` reports at least one colour page. Two paths:
 *  - Accept    : caller applies the suggestion (colour pages → 'colour',
 *                rest → 'bw'). The prompt dismisses itself.
 *  - Customize : caller opens the Mix preset (the PageStrip) so the
 *                customer can pick pages manually. The prompt dismisses.
 *
 * The prompt is intentionally NOT dismissible via an X button — the only
 * two ways out are Accept or Customize, both of which dismiss it (the
 * "don't nag" rule).
 *
 * Clear visual language: accent-tint background + accent-tint-text,
 * accent border. Reads as a hint, not an alert.
 */

export interface ColorSuggestion {
  page: number;
  isColor: boolean;
}

export interface ColorSuggestionPromptProps {
  suggestion: ColorSuggestion[];
  onAccept: () => void;
  onCustomize: () => void;
  filename?: string;
}

export function ColorSuggestionPrompt({
  suggestion,
  onAccept,
  onCustomize,
  filename,
}: ColorSuggestionPromptProps) {
  const colorPageCount = useMemo(
    () => suggestion.filter((s) => s.isColor).length,
    [suggestion],
  );

  if (colorPageCount === 0) return null;

  return (
    <section
      className="rounded-[var(--radius-card)] border border-[var(--accent-tint)] bg-[var(--accent-tint)] p-4"
      aria-labelledby="color-suggestion-heading"
      role="note"
    >
      <div className="flex items-start gap-3">
        <Sparkles
          className="size-5 shrink-0 mt-0.5 text-[var(--accent-tint-text)]"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p
            id="color-suggestion-heading"
            className="text-sm font-semibold text-[var(--accent-tint-text)]"
          >
            {colorPageCount} {colorPageCount === 1 ? 'page looks' : 'pages look'} colourful.
          </p>
          {filename ? (
            <p className="mt-0.5 text-[13px] text-[var(--label-2)] truncate">
              In {filename}
            </p>
          ) : null}
          <p className="mt-1 text-[13px] text-[var(--label-2)]">
            Print those in colour?
          </p>

          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <PrimaryButton size="compact" onClick={onAccept}>
              Accept
            </PrimaryButton>
            <TintedButton size="compact" onClick={onCustomize}>
              Customize
            </TintedButton>
          </div>
        </div>
      </div>
    </section>
  );
}

export { ColorSuggestionPrompt as ClearColorSuggestionPrompt };
export default ColorSuggestionPrompt;

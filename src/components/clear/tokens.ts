export type PageMode = 'bw' | 'colour' | 'skip';

export const PAGE_MODE_LABELS: Record<PageMode, string> = {
  bw: 'B&W',
  colour: 'Colour',
  skip: 'Skip',
};

/**
 * Clear design-system tokens (spec §A, measured from the design renders).
 *
 * Single source of truth for the token *values*; the CSS variables of the
 * same names in `src/app/globals.css` (`:root`) are what components actually
 * read at runtime. Keep the two in sync — if a value changes here, change
 * it in globals.css too (and vice versa).
 *
 * The PDF has no dark mode and the `.ref-*` classes are light-only, so
 * these are light-mode values only. There is intentionally no dark
 * variant of this table.
 */
export const CLEAR_TOKENS = {
  /** Page background / input fill. */
  pageBackground: '#F2F3F7',
  /** Card / surface. */
  card: '#FFFFFF',
  /** Primary blue — buttons, selected radios, filled progress. */
  primary: '#0A58D6',
  /** Light-blue fill — secondary buttons, active nav, blue pills. */
  primaryLightFill: '#E6EEFB',
  /** Green toggle. */
  green: '#1E8A56',
  /** Green pill background. */
  greenPill: '#DDF3E7',
  /** Amber pill background. */
  amberPill: '#FFF1CC',
  /** Red pill background. */
  redPill: '#FAE3E1',
  /** Segmented-control track. */
  segmentedTrack: '#E3E4E9',
  /** Unfilled progress-segment track. */
  progressTrack: '#DADBE0',
  /** Input fill (same as page background). */
  inputFill: '#F2F3F7',
  /** Near-black text. */
  text: '#1C1C1E',
  /** Content container width (desktop consumer pages, site header/footer). */
  contentMaxWidthPx: 1120,
  /** Mobile single-column width. */
  mobileMaxWidthPx: 640,
  /** Card corner radius (spec: 20–24px). */
  cardRadiusPx: 22,
  /** Minimum touch-target height. */
  touchTargetPx: 48,
} as const;

export type ClearTokens = typeof CLEAR_TOKENS;

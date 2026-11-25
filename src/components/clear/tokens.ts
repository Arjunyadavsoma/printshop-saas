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

/**
 * Halo identity tokens (from the shop sign-in screen, PR #10).
 *
 * Single source of truth for the token *values*; the CSS variables of the
 * same names in `src/app/globals.css` (`:root`, `--halo-*`) are what
 * components actually read at runtime. Keep the two in sync.
 *
 * Mode-independent: halo screens are dark by design in both modes.
 * Consumer pages stay light Clear but share the same type scale, pill
 * buttons, radii, and the live-dot motif from this table.
 */
export const HALO_TOKENS = {
  /** Dark halo surface (sign-in screen background). */
  surface: '#0B0B0D',
  /** Dark pill / card on the halo surface. */
  card: '#1C1C1F',
  /** Dark pill hover. */
  cardHover: '#232327',
  /** Blue ambient glow (top), strong + soft stops. */
  glowBlue: 'rgba(10, 88, 214, 0.28)',
  glowBlueSoft: 'rgba(10, 88, 214, 0.08)',
  /** Green ambient glow (bottom). */
  glowGreen: 'rgba(30, 138, 86, 0.12)',
  /** Pulsing live-status dot. */
  live: '#34D399',
  /** White provider pill fill (85% white). */
  pillWhite: 'rgba(255, 255, 255, 0.85)',
  /** Near-black ink on the white pills. */
  pillInk: '#1C1C1E',
  /** Wordmark size (sign-in screen). */
  wordmarkPx: 28,
  /** Provider pill height. */
  pillHeightPx: 56,
  /** Primary action height (shared with ClearButton default). */
  primaryHeightPx: 52,
} as const;

export type HaloTokens = typeof HALO_TOKENS;

/**
 * Shared consumer type scale (px). Mirrors the `.type-*` utilities in
 * `src/app/globals.css` — components read the CSS classes; this table
 * exists so non-CSS code (tests, docs) can cite the same numbers.
 */
export const TYPE_SCALE = {
  /** Page hero headline: 34 mobile, 44 desktop. */
  heroMobilePx: 34,
  heroDesktopPx: 44,
  /** Plain page title (info pages, tracking). */
  pageTitlePx: 28,
  /** Section heading inside a page. */
  sectionPx: 18,
  /** Subtitle / body copy. */
  bodyPx: 16,
  /** Caption text. */
  captionPx: 14,
} as const;

/**
 * Design tokens for the customer flow.
 * Re-exported here so components can import them as typed constants
 * instead of hardcoding hex values. The CSS variables live in globals.css
 * under the @theme block; these are the TS-side mirrors for any JS-side
 * logic (e.g., canvas rendering, inline styles for dynamic values).
 */

export const colors = {
  paper: '#F7F8FA',
  surface: '#FFFFFF',
  ink: '#0F1B2D',
  muted: '#5B6675',
  cyanInk: '#006FA6',
  magentaInk: '#C2185B',
  yellowInk: '#FFD60A',
  success: '#0B7A4B',
  warning: '#F59E0B',
  error: '#B3261E',
} as const;

export const radii = {
  tight: '4px',
  default: '8px',
  soft: '16px',
  full: '9999px',
} as const;

export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  12: '48px',
} as const;

export const typeScale = {
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '20px',
  xl: '24px',
  '2xl': '32px',
} as const;

/** Page color modes — the three states a page can be in. */
export type PageMode = 'bw' | 'colour' | 'skip';

/** The CMYK page-mode labels (never colour-alone — always text + icon). */
export const PAGE_MODE_LABELS: Record<PageMode, string> = {
  bw: 'B&W',
  colour: 'Colour',
  skip: 'Skip',
};

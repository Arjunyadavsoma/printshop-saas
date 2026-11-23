/**
 * PrintShop "Clear" design system — TypeScript token mirrors.
 *
 * These mirror the CSS variables in globals.css for any JS-side logic
 * (canvas rendering, inline styles for dynamic values). Components should
 * prefer CSS variables (var(--ground), var(--accent), etc.) via Tailwind
 * arbitrary values over these TS constants.
 *
 * English only. No Hindi/Telugu. No Anek. No CMYK.
 */

export const colors = {
  ground: '#F2F3F7',
  surface: '#FFFFFF',
  label: '#1C1C1E',
  label2: '#5B5F66',
  label3: '#6B6F76',
  hairline: '#DADBE1',
  track: '#E3E4EA',
  fill: '#F2F3F7',
  accent: '#0A58D6',
  accentPress: '#094FBF',
  onAccent: '#FFFFFF',
  accentTint: '#E6EEFC',
  accentTintText: '#0A4CB8',
  success: '#1F8A55',
  successTint: '#DDF3E7',
  successText: '#14663F',
  warning: '#F5C400',
  warningTint: '#FFF1CC',
  warningText: '#7A4B00',
  danger: '#B3261E',
  dangerTint: '#FBE3E1',
  dangerText: '#9C1F18',
} as const;

export const radii = {
  input: 12,
  thumb: 12,
  segmentTrack: 12,
  segmentInner: 10,
  group: 22,
  sheet: 28,
  card: 14,
  kanban: 18,
  chip: 9999,
  button: 9999,
} as const;

/** Page colour modes — the three states a page can be in. */
export type PageMode = 'bw' | 'colour' | 'skip';

/** The page-mode labels (never colour-alone — always text + dot). */
export const PAGE_MODE_LABELS: Record<PageMode, string> = {
  bw: 'B&W',
  colour: 'Colour',
  skip: 'Skip',
};

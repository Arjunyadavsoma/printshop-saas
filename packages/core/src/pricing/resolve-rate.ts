import type { ColorMode, PaperSize } from '../domain';
import type { ShopPricingConfig } from '../domain';

/**
 * Build the dynamic key the {@link ShopPricingConfig} is indexed by, e.g.
 * `bw_a4_per_page`. This is what makes adding new paper sizes a config
 * change, not a code change.
 *
 * @param colorMode - "bw" | "color"
 * @param paperSize - "a4" | "a3" | "letter" | "legal"
 * @returns the config key
 */
export function perPageKey(colorMode: ColorMode, paperSize: PaperSize): string {
  return `${colorMode}_${paperSize}_per_page`;
}

/**
 * Human-readable colour name for line-item labels.
 * @param mode - the colour mode
 * @returns "B&W" or "Colour"
 */
export function colorLabel(mode: ColorMode): string {
  return mode === 'bw' ? 'B&W' : 'Colour';
}

/**
 * Fetch the per-page rate for a (color, paper) pair from a shop config.
 * Falls back to A4 rates for letter/legal when the shop hasn't configured
 * those sizes — keeps existing shops working after we add new sizes.
 *
 * @param config - the shop's pricing config
 * @param colorMode - bw | color
 * @param paperSize - a4 | a3 | letter | legal
 * @returns the per-page rate in paise (always ≥ 0)
 */
export function resolveBaseRate(
  config: ShopPricingConfig,
  colorMode: ColorMode,
  paperSize: PaperSize,
): number {
  const direct = config[perPageKey(colorMode, paperSize) as keyof ShopPricingConfig];
  if (typeof direct === 'number' && direct > 0) {
    return direct;
  }
  // Fallback ladder: letter → a4, legal → a3.
  const fallback: PaperSize = paperSize === 'legal' ? 'a3' : 'a4';
  const fallbackRate = config[perPageKey(colorMode, fallback) as keyof ShopPricingConfig];
  return typeof fallbackRate === 'number' ? fallbackRate : 0;
}

/**
 * Round a non-negative number half-up to the nearest integer (paise).
 * We can't trust Math.round on negatives, so we require non-negative input.
 *
 * @param value - a non-negative number
 * @returns the integer paise, half-up
 */
export function roundHalfUpPaise(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`roundHalfUpPaise: value must be a non-negative finite number, got ${value}`);
  }
  // Adding 0.5 then flooring gives correct half-up for positives.
  return Math.floor(value + 0.5);
}

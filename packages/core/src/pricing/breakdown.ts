import type { PricingInput, PricingBreakdown, PricingBehaviour } from './types';
import { resolveBaseRate, roundHalfUpPaise } from './resolve-rate';

/** Default behaviour: round up below the minimum (the kinder UX choice). */
export const DEFAULT_PRICING_BEHAVIOUR: PricingBehaviour = { onBelowMin: 'round_up' };

/**
 * Compute the raw breakdown — every value already rounded to paise, before
 * building line items. Kept separate so the line-item builder and the tests
 * can both read the same intermediate numbers.
 *
 * @param input - the file to price
 * @returns the paise-level breakdown
 */
export function computeBreakdown(input: PricingInput): PricingBreakdown {
  const { pages, copies, duplex, colorMode, paperSize, shopPricingConfig: cfg } = input;
  if (!Number.isInteger(pages) || pages <= 0) {
    throw new Error(`computeBreakdown: pages must be a positive integer, got ${pages}`);
  }
  if (!Number.isInteger(copies) || copies <= 0) {
    throw new Error(`computeBreakdown: copies must be a positive integer, got ${copies}`);
  }

  const baseRatePaise = resolveBaseRate(cfg, colorMode, paperSize);
  const totalPages = pages * copies;
  const grossPaise = roundHalfUpPaise(baseRatePaise * totalPages);

  // Duplex discount is a percentage off the gross (saves paper).
  const duplexSavingPaise =
    duplex && cfg.duplex_discount > 0
      ? roundHalfUpPaise((grossPaise * cfg.duplex_discount) / 100)
      : 0;

  // Bulk discount applies to the post-duplex subtotal.
  const afterDuplex = grossPaise - duplexSavingPaise;
  const bulkSavingPaise =
    totalPages >= cfg.bulk_threshold && cfg.bulk_discount_pct > 0
      ? roundHalfUpPaise((afterDuplex * cfg.bulk_discount_pct) / 100)
      : 0;

  const subtotal = afterDuplex - bulkSavingPaise;
  const minOrderAdjPaise =
    subtotal < cfg.min_order_value ? cfg.min_order_value - subtotal : 0;

  return { baseRatePaise, totalPages, grossPaise, duplexSavingPaise, bulkSavingPaise, minOrderAdjPaise };
}

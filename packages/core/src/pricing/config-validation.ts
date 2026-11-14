import type { ShopPricingConfig } from '../domain';

/**
 * Error thrown when a shop's pricing configuration is missing or invalid.
 *
 * This is NOT the same as "free printing" (where the shop explicitly sets all
 * rates to 0). Missing configuration (undefined keys, empty object) means the
 * shop hasn't been set up for billing — the file must NOT be priced at ₹0.
 */
export class PricingConfigUnavailableError extends Error {
  constructor(
    message: string,
    public readonly shopId?: string,
  ) {
    super(message);
    this.name = 'PricingConfigUnavailableError';
  }
}

/**
 * Check whether a shop's pricing config has the minimum required keys to
 * produce a trustworthy price.
 *
 * A valid config must have `bw_a4_per_page` defined as a number (the base
 * rate that all other paper sizes fall back to). If this key is `undefined`,
 * the config is either an empty object `{}` or a malformed partial — the
 * pricing engine would silently produce ₹0, which is a revenue bug.
 *
 * A config with `bw_a4_per_page: 0` is considered valid (explicitly free
 * printing, e.g. a school). The distinction is `typeof === 'number'` vs
 * `undefined`.
 */
export function hasValidPricingConfig(config: ShopPricingConfig): boolean {
  if (!config || typeof config !== 'object') return false;
  // Access via Record to detect missing keys at runtime (the TS type says
  // `number`, but a malformed/empty config from the DB can have `undefined`).
  const bwA4 = (config as unknown as Record<string, unknown>)['bw_a4_per_page'];
  return typeof bwA4 === 'number' && bwA4 >= 0 && Number.isFinite(bwA4);
}

/**
 * Throw `PricingConfigUnavailableError` if the config is missing or invalid.
 * Call this before any `priceFile()` call to prevent silent ₹0 pricing.
 */
export function validatePricingConfig(
  config: ShopPricingConfig,
  shopId?: string,
): void {
  if (!hasValidPricingConfig(config)) {
    throw new PricingConfigUnavailableError(
      'Shop pricing configuration is unavailable — rates have not been set up. ' +
        'The shopkeeper must configure pricing before files can be priced.',
      shopId,
    );
  }
}

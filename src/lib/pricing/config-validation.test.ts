import { describe, it, expect } from 'vitest';
import {
  hasValidPricingConfig,
  validatePricingConfig,
  PricingConfigUnavailableError,
} from '@platform/core/pricing';
import {
  createDefaultPricingConfig,
  type ShopPricingConfig,
} from '@platform/core/domain';

/**
 * Unit tests for the shop pricing-config guard.
 *
 * The distinction these tests pin down is the difference between:
 *   - "the shop has not configured rates yet" (missing keys → UNAVAILABLE),
 *   - "the shop is explicitly free" (all rates set to 0 → VALID).
 *
 * Confusing those two would be a revenue bug: an un-configured shop would
 * silently bill ₹0 for every print, leaking paper + toner for free. The
 * guard treats only `typeof bw_a4_per_page === 'number'` (incl. 0) as valid
 * — `undefined`, `null`, `{}`, or a non-object all fail.
 *
 * `hasValidPricingConfig` returns a boolean; `validatePricingConfig` throws
 * `PricingConfigUnavailableError` (carrying the shopId for ops triage).
 */

describe('hasValidPricingConfig', () => {
  it('returns true for a fully-populated config (createDefaultPricingConfig)', () => {
    const cfg = createDefaultPricingConfig();
    // Sanity: the default config has every key set to a non-negative number.
    expect(cfg.bw_a4_per_page).toBeGreaterThan(0);
    expect(hasValidPricingConfig(cfg)).toBe(true);
  });

  it('returns false for an empty config object {} (shop not set up)', () => {
    // A malformed/partial config from the DB may have zero keys set.
    // TS forces the cast through `unknown` because ShopPricingConfig requires
    // every field — at runtime the object is genuinely empty.
    const empty = {} as unknown as ShopPricingConfig;
    expect(hasValidPricingConfig(empty)).toBe(false);
  });

  it('returns true when bw_a4_per_page is explicitly 0 (free printing)', () => {
    // A school / community print shop may legitimately set all rates to 0.
    // The guard must NOT treat "explicitly free" as "unconfigured" — that
    // would force every free shop to enter a fake non-zero rate just to
    // pass the guard, polluting downstream reports.
    const freeConfig: ShopPricingConfig = {
      ...createDefaultPricingConfig(),
      bw_a4_per_page: 0,
    };
    expect(hasValidPricingConfig(freeConfig)).toBe(true);
  });

  it('returns false when bw_a4_per_page is undefined (key missing)', () => {
    // Spreading a config with `bw_a4_per_page: undefined` produces an object
    // whose key EXISTS but holds `undefined`. The guard checks the VALUE's
    // type, so this must fail (mirrors a row where the column was NULL).
    const partial = {
      ...createDefaultPricingConfig(),
      bw_a4_per_page: undefined,
    } as unknown as ShopPricingConfig;
    expect(hasValidPricingConfig(partial)).toBe(false);
  });

  it('returns false for null and undefined configs', () => {
    expect(hasValidPricingConfig(null as unknown as ShopPricingConfig)).toBe(false);
    expect(hasValidPricingConfig(undefined as unknown as ShopPricingConfig)).toBe(false);
  });
});

describe('validatePricingConfig', () => {
  it('does not throw for a valid config', () => {
    const cfg = createDefaultPricingConfig();
    expect(() => validatePricingConfig(cfg, 'shop-123')).not.toThrow();
  });

  it('throws PricingConfigUnavailableError for an empty config {}', () => {
    const empty = {} as unknown as ShopPricingConfig;
    expect(() => validatePricingConfig(empty, 'shop-456')).toThrow(PricingConfigUnavailableError);
    try {
      validatePricingConfig(empty, 'shop-456');
    } catch (e) {
      // The error must carry the shopId so ops/SREs can find the offending
      // shop in logs (a generic "pricing unavailable" without a shopId is
      // useless at 3am during an incident).
      expect(e).toBeInstanceOf(PricingConfigUnavailableError);
      expect((e as PricingConfigUnavailableError).shopId).toBe('shop-456');
      expect((e as Error).message).toMatch(/pricing configuration is unavailable/i);
    }
  });

  it('does NOT throw for an explicitly-free config (bw_a4_per_page: 0)', () => {
    // The free-printing case must pass — see hasValidPricingConfig rationale.
    const freeConfig: ShopPricingConfig = {
      ...createDefaultPricingConfig(),
      bw_a4_per_page: 0,
    };
    expect(() => validatePricingConfig(freeConfig, 'shop-free')).not.toThrow();
  });

  it('throws PricingConfigUnavailableError when bw_a4_per_page is undefined', () => {
    const partial = {
      ...createDefaultPricingConfig(),
      bw_a4_per_page: undefined,
    } as unknown as ShopPricingConfig;
    expect(() => validatePricingConfig(partial, 'shop-789')).toThrow(PricingConfigUnavailableError);
  });

  it('throws PricingConfigUnavailableError for null/undefined config', () => {
    expect(() =>
      validatePricingConfig(null as unknown as ShopPricingConfig, 'shop-null'),
    ).toThrow(PricingConfigUnavailableError);
    expect(() =>
      validatePricingConfig(undefined as unknown as ShopPricingConfig, 'shop-undef'),
    ).toThrow(PricingConfigUnavailableError);
  });
});

import { describe, expect, it } from 'vitest';
import { priceFile, PricingBelowMinimumError, resolveBaseRate, roundHalfUpPaise } from './index';
import { createDefaultPricingConfig, type ShopPricingConfig } from '../domain';
import type { PricingInput } from './index';

/** A config with round, easy-to-reason numbers. Min order disabled here so
 * the base / duplex / bulk tests aren't affected by rounding; the minimum-order
 * section re-enables it explicitly. */
function flatConfig(overrides: Partial<ShopPricingConfig> = {}): ShopPricingConfig {
  return {
    ...createDefaultPricingConfig(),
    bw_a4_per_page: 100, // ₹1
    color_a4_per_page: 500, // ₹5
    bw_a3_per_page: 200,
    color_a3_per_page: 1000,
    bw_letter_per_page: 100,
    color_letter_per_page: 500,
    bw_legal_per_page: 150,
    color_legal_per_page: 750,
    duplex_discount: 10,
    bulk_threshold: 100,
    bulk_discount_pct: 5,
    min_order_value: 0,
    ...overrides,
  };
}

function makeInput(over: Partial<PricingInput> = {}): PricingInput {
  return {
    pages: 1,
    copies: 1,
    colorMode: 'bw',
    paperSize: 'a4',
    duplex: false,
    shopPricingConfig: flatConfig(),
    ...over,
  };
}

describe('roundHalfUpPaise', () => {
  it('rounds 0.5 up to 1', () => {
    expect(roundHalfUpPaise(0.5)).toBe(1);
  });
  it('rounds 0.4 down to 0', () => {
    expect(roundHalfUpPaise(0.4)).toBe(0);
  });
  it('rounds 10.5 up to 11 (half-up, not banker rounding)', () => {
    expect(roundHalfUpPaise(10.5)).toBe(11);
  });
  it('throws on negative input', () => {
    expect(() => roundHalfUpPaise(-1)).toThrow();
  });
  it('throws on NaN', () => {
    expect(() => roundHalfUpPaise(Number.NaN)).toThrow();
  });
});

describe('resolveBaseRate fallback', () => {
  it('returns the direct rate when configured', () => {
    expect(resolveBaseRate(flatConfig(), 'color', 'a4')).toBe(500);
  });
  it('falls back letter → a4 when letter rate is 0', () => {
    const cfg = flatConfig({ bw_letter_per_page: 0, bw_a4_per_page: 77 });
    expect(resolveBaseRate(cfg, 'bw', 'letter')).toBe(77);
  });
  it('falls back legal → a3 when legal rate is 0', () => {
    const cfg = flatConfig({ color_legal_per_page: 0, color_a3_per_page: 999 });
    expect(resolveBaseRate(cfg, 'color', 'legal')).toBe(999);
  });
});

describe('priceFile — base cases', () => {
  it('prices a single B&W A4 page at the per-page rate', () => {
    const r = priceFile(makeInput());
    expect(r.totalPaise).toBe(100);
    expect(r.lineItems).toHaveLength(1);
    expect(r.lineItems[0]!.label).toContain('B&W');
  });
  it('prices a single colour A4 page', () => {
    const r = priceFile(makeInput({ colorMode: 'color' }));
    expect(r.totalPaise).toBe(500);
  });
  it('multiplies by copies', () => {
    const r = priceFile(makeInput({ copies: 3 }));
    expect(r.totalPaise).toBe(300); // 100 * 3
    expect(r.lineItems[0]!.quantity).toBe(3);
  });
  it('multiplies pages × copies for totalPages', () => {
    const r = priceFile(makeInput({ pages: 4, copies: 2 }));
    expect(r.lineItems[0]!.quantity).toBe(8);
    expect(r.totalPaise).toBe(800);
  });
});

describe('priceFile — duplex discount', () => {
  it('applies duplex discount off the gross', () => {
    const r = priceFile(makeInput({ pages: 10, duplex: true }));
    // gross 1000, duplex 10% → save 100 → 900
    expect(r.totalPaise).toBe(900);
    expect(r.lineItems).toHaveLength(2);
    expect(r.lineItems[1]!.label).toContain('Duplex');
    expect(r.lineItems[1]!.subtotalPaise).toBe(-100);
  });
  it('skips duplex line item when duplex is false', () => {
    const r = priceFile(makeInput({ pages: 10, duplex: false }));
    expect(r.lineItems.some((i) => i.label.includes('Duplex'))).toBe(false);
  });
  it('skips duplex discount when config.duplex_discount is 0', () => {
    const cfg = flatConfig({ duplex_discount: 0 });
    const r = priceFile(makeInput({ pages: 10, duplex: true, shopPricingConfig: cfg }));
    expect(r.totalPaise).toBe(1000);
  });
  it('rounds duplex saving half-up', () => {
    // gross 105 (1.05 INR... use a rate of 21/page * 5 pages = 105), 10% = 10.5 → 11
    const cfg = flatConfig({ bw_a4_per_page: 21 });
    const r = priceFile(makeInput({ pages: 5, duplex: true, shopPricingConfig: cfg }));
    expect(r.totalPaise).toBe(94); // 105 - 11
  });
});

describe('priceFile — bulk discount', () => {
  it('applies bulk discount when totalPages >= threshold', () => {
    // 100 pages * 100 = 10000; bulk 5% → 500 saved → 9500
    const r = priceFile(makeInput({ pages: 100 }));
    expect(r.totalPaise).toBe(9500);
    expect(r.lineItems.some((i) => i.label.includes('Bulk'))).toBe(true);
  });
  it('does NOT apply bulk discount below threshold (boundary)', () => {
    const r = priceFile(makeInput({ pages: 99 }));
    expect(r.totalPaise).toBe(9900);
    expect(r.lineItems.some((i) => i.label.includes('Bulk'))).toBe(false);
  });
  it('applies bulk discount exactly at threshold (boundary)', () => {
    const r = priceFile(makeInput({ pages: 100 }));
    expect(r.lineItems.some((i) => i.label.includes('Bulk'))).toBe(true);
  });
  it('applies bulk after duplex (post-duplex base)', () => {
    // 100 pages gross 10000, duplex 10% → save 1000 → 9000, bulk 5% → save 450 → 8550
    const r = priceFile(makeInput({ pages: 100, duplex: true }));
    expect(r.totalPaise).toBe(8550);
  });
  it('skips bulk when bulk_discount_pct is 0 even if over threshold', () => {
    const cfg = flatConfig({ bulk_discount_pct: 0 });
    const r = priceFile(makeInput({ pages: 100, shopPricingConfig: cfg }));
    expect(r.totalPaise).toBe(10000);
  });
});

describe('priceFile — minimum order', () => {
  it('rounds up to min_order_value when subtotal is below', () => {
    // 1 page * 100 = 100, min is 500 → rounded up, with adjustment line
    const r = priceFile(makeInput({ pages: 1, shopPricingConfig: flatConfig({ min_order_value: 500 }) }));
    expect(r.totalPaise).toBe(500);
    expect(r.lineItems.some((i) => i.label.includes('Minimum'))).toBe(true);
  });
  it('does NOT adjust when subtotal equals min exactly', () => {
    // 5 pages * 100 = 500, min 500 → no adjustment
    const r = priceFile(makeInput({ pages: 5, shopPricingConfig: flatConfig({ min_order_value: 500 }) }));
    expect(r.totalPaise).toBe(500);
    expect(r.lineItems.some((i) => i.label.includes('Minimum'))).toBe(false);
  });
  it('does NOT adjust when subtotal exceeds min', () => {
    const r = priceFile(makeInput({ pages: 6, shopPricingConfig: flatConfig({ min_order_value: 500 }) }));
    expect(r.totalPaise).toBe(600);
  });
  it('rejects when behaviour.onBelowMin = reject', () => {
    expect(() =>
      priceFile(makeInput({ pages: 1, shopPricingConfig: flatConfig({ min_order_value: 500 }) }), {
        onBelowMin: 'reject',
      }),
    ).toThrow(PricingBelowMinimumError);
  });
  it('rounds up when bulk discount would drop below min', () => {
    // Config: min 5000, rate 100/page, threshold 1, bulk 90% → tiny order
    const cfg = flatConfig({ min_order_value: 5000, bulk_threshold: 1, bulk_discount_pct: 90 });
    // 1 page: gross 100, bulk 90% → save 90 → 10, below min 5000 → round up
    const r = priceFile(makeInput({ shopPricingConfig: cfg }));
    expect(r.totalPaise).toBe(5000);
  });
});

describe('priceFile — colour & paper variants', () => {
  it('prices colour A3', () => {
    const r = priceFile(makeInput({ colorMode: 'color', paperSize: 'a3' }));
    expect(r.totalPaise).toBe(1000);
  });
  it('prices B&W letter using configured letter rate', () => {
    const r = priceFile(makeInput({ paperSize: 'letter' }));
    expect(r.totalPaise).toBe(100);
  });
  it('prices colour legal', () => {
    const r = priceFile(makeInput({ colorMode: 'color', paperSize: 'legal', copies: 4 }));
    expect(r.lineItems[0]!.quantity).toBe(4);
  });
});

describe('priceFile — mixed scenarios', () => {
  it('colour duplex bulk order', () => {
    // 50 copies of 2 colour A4 pages = 100 pages, rate 500 → 50000
    // duplex 10% → 5000 saved → 45000
    // bulk 5% → 2250 saved → 42750
    const r = priceFile(
      makeInput({ pages: 2, copies: 50, colorMode: 'color', duplex: true }),
    );
    expect(r.totalPaise).toBe(42750);
  });
  it('returns line items in gross→duplex→bulk→min order', () => {
    // Force below min with duplex+bulk so all four lines appear
    const cfg = flatConfig({
      bw_a4_per_page: 1,
      bulk_threshold: 1,
      bulk_discount_pct: 50,
      min_order_value: 1000,
    });
    const r = priceFile(
      makeInput({ pages: 100, duplex: true, shopPricingConfig: cfg }),
    );
    const labels = r.lineItems.map((i) => i.label);
    expect(labels[0]).toContain('Print');
    expect(labels[1]).toContain('Duplex');
    expect(labels[2]).toContain('Bulk');
    expect(labels[3]).toContain('Minimum');
  });
  it('handles zero-rate free printing (e.g. promo)', () => {
    const cfg = flatConfig({ bw_a4_per_page: 0, bulk_threshold: 1_000_000 });
    const r = priceFile(makeInput({ pages: 5, shopPricingConfig: cfg }));
    expect(r.totalPaise).toBe(0);
  });
});

describe('priceFile — invalid input', () => {
  it('throws on zero pages', () => {
    expect(() => priceFile(makeInput({ pages: 0 }))).toThrow();
  });
  it('throws on zero copies', () => {
    expect(() => priceFile(makeInput({ copies: 0 }))).toThrow();
  });
  it('throws on negative pages', () => {
    expect(() => priceFile(makeInput({ pages: -1 }))).toThrow();
  });
});

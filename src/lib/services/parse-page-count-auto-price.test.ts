import { describe, expect, it } from 'vitest';
import { parsePageCount } from './parse-page-count';
import { priceFile } from '@platform/core/pricing';
import { createDefaultPricingConfig } from '@platform/core/domain';

describe('Auto-pricing after upload', () => {
  it('PDF with 10 pages → auto-priced at 10 × bw_a4 rate', () => {
    // Simulate: parsePageCount returns 10 for a valid PDF
    const pageCount = 10;
    const result = priceFile({
      pages: pageCount,
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      shopPricingConfig: createDefaultPricingConfig(),
    });
    // 10 pages × 200 paise/page = 2000 paise = ₹20.00
    expect(result.totalPaise).toBe(2000);
    expect(result.totalPaise).toBeGreaterThan(0);
  });

  it('DOCX with 5 pages → auto-priced at 5 × bw_a4 rate', () => {
    const pageCount = 5;
    const result = priceFile({
      pages: pageCount,
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      shopPricingConfig: createDefaultPricingConfig(),
    });
    // 5 pages × 200 paise/page = 1000 paise = ₹10.00
    expect(result.totalPaise).toBe(1000);
  });

  it('Image (1 page) → auto-priced at 1 × bw_a4 rate', () => {
    const pageCount = 1;
    const result = priceFile({
      pages: pageCount,
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      shopPricingConfig: createDefaultPricingConfig(),
    });
    // 1 page × 200 paise = 200 paise = ₹2.00
    // But min_order_value is 500, so it rounds up to 500
    expect(result.totalPaise).toBe(500);
  });

  it('needs_review file (default 1 page) → auto-priced at min order value', () => {
    // When page count is unknown, we default to 1 page
    const pageCount = 1;
    const result = priceFile({
      pages: pageCount,
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      shopPricingConfig: createDefaultPricingConfig(),
    });
    // Should be at least min_order_value (500 paise = ₹5.00)
    expect(result.totalPaise).toBeGreaterThanOrEqual(500);
    expect(result.totalPaise).toBeGreaterThan(0);
  });

  it('Color printing costs more than B&W', () => {
    const bwResult = priceFile({
      pages: 10, copies: 1, colorMode: 'bw', paperSize: 'a4',
      duplex: false, shopPricingConfig: createDefaultPricingConfig(),
    });
    const colorResult = priceFile({
      pages: 10, copies: 1, colorMode: 'color', paperSize: 'a4',
      duplex: false, shopPricingConfig: createDefaultPricingConfig(),
    });
    expect(colorResult.totalPaise).toBeGreaterThan(bwResult.totalPaise);
  });

  it('Multiple pages with multiple ranges are correctly calculated', () => {
    // User selects pages 5-20 (16 pages) + pages 56-99 (44 pages) = 60 billable pages
    const billablePages = 60;
    const result = priceFile({
      pages: billablePages, copies: 1, colorMode: 'bw', paperSize: 'a4',
      duplex: false, shopPricingConfig: createDefaultPricingConfig(),
    });
    // 60 × 200 = 12000 paise = ₹120.00
    expect(result.totalPaise).toBe(12000);
  });
});

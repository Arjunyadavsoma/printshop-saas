import { describe, expect, it } from 'vitest';
import { parsePageRange, resolveBillablePages } from './page-selection';
import { priceFile } from '@platform/core/pricing';
import { createDefaultPricingConfig, type ShopPricingConfig } from '@platform/core/domain';
import type { PricingInput } from '@platform/core/pricing';

/**
 * P1-15 — server-authoritative page selection.
 *
 * Before this fix the PATCH `/api/v1/orders/:id/files/:fileId` endpoint used
 * `file.pageCount` for pricing even when the customer supplied a `pageRange`.
 * A 3-of-200 selection was billed for 200 pages — direct revenue leakage.
 *
 * These tests cover the `parsePageRange` + `resolveBillablePages` helpers in
 * isolation. The full PATCH→checkout integration is exercised in
 * `pricing-with-selection.test.ts`.
 */

/** A flat config with easy-to-reason numbers (min order disabled). */
function flatConfig(overrides: Partial<ShopPricingConfig> = {}): ShopPricingConfig {
  return {
    ...createDefaultPricingConfig(),
    bw_a4_per_page: 100, // ₹1 / page
    color_a4_per_page: 500, // ₹5 / page
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

describe('parsePageRange — valid inputs', () => {
  it('1. all-pages sentinel: null/empty range → caller falls back to pageCount (resolveBillablePages)', () => {
    const r = resolveBillablePages(null, 200);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.billablePages).toBe(200);
    expect(r.selectedPages).toBeNull();
  });

  it('2. single page "3" → billablePages = 1', () => {
    const sel = parsePageRange('3', 200);
    expect(sel).toEqual([3]);
    const r = resolveBillablePages('3', 200);
    if ('error' in r) throw new Error('should not error');
    expect(r.billablePages).toBe(1);
  });

  it('3. multiple individual pages "1,3,5" → billablePages = 3', () => {
    const sel = parsePageRange('1,3,5', 200);
    expect(sel).toEqual([1, 3, 5]);
    const r = resolveBillablePages('1,3,5', 200);
    if ('error' in r) throw new Error('should not error');
    expect(r.billablePages).toBe(3);
  });

  it('4. single range "1-5" → billablePages = 5', () => {
    const sel = parsePageRange('1-5', 200);
    expect(sel).toEqual([1, 2, 3, 4, 5]);
    const r = resolveBillablePages('1-5', 200);
    if ('error' in r) throw new Error('should not error');
    expect(r.billablePages).toBe(5);
  });

  it('5. mixed ranges and individuals "2-4,8,10-12" → billablePages = 7', () => {
    const sel = parsePageRange('2-4,8,10-12', 200);
    expect(sel).toEqual([2, 3, 4, 8, 10, 11, 12]);
    const r = resolveBillablePages('2-4,8,10-12', 200);
    if ('error' in r) throw new Error('should not error');
    expect(r.billablePages).toBe(7);
  });

  it('5b. overlapping ranges de-duplicate (don\'t bill a page twice)', () => {
    // "1-5,3-7" → 1,2,3,4,5,6,7 (7 pages, not 10)
    const sel = parsePageRange('1-5,3-7', 200);
    expect(sel).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sel!.length).toBe(7);
  });

  it('5c. whitespace tolerated (" 1 , 3 , 5 ")', () => {
    const sel = parsePageRange(' 1 , 3 , 5 ', 200);
    expect(sel).toEqual([1, 3, 5]);
  });
});

describe('parsePageRange — copies multiply correctly', () => {
  it('6. billablePages × copies = priced pages (5 pages × 3 copies = 15)', () => {
    const r = resolveBillablePages('1-5', 200);
    if ('error' in r) throw new Error('should not error');
    const billable = r.billablePages;
    const copies = 3;
    // Price a 5-page selection × 3 copies at ₹1/page = ₹15 = 1500 paise.
    const priced = priceFile(makeInput({ pages: billable, copies }));
    expect(priced.totalPaise).toBe(1500);
    // Line-item quantity must reflect the product (5 × 3 = 15).
    expect(priced.lineItems[0]!.quantity).toBe(15);
  });
});

describe('parsePageRange — colour + duplex with selected pages', () => {
  it('7. colour + duplex pricing honours the selected page count', () => {
    // 5 colour A4 pages @ ₹5/page = ₹25 = 2500 paise
    // duplex 10% off → 250 saved → 2250 paise
    const r = resolveBillablePages('1-5', 200);
    if ('error' in r) throw new Error('should not error');
    const priced = priceFile(
      makeInput({
        pages: r.billablePages,
        colorMode: 'color',
        duplex: true,
      }),
    );
    expect(priced.totalPaise).toBe(2250);
    expect(priced.lineItems[0]!.quantity).toBe(5);
    expect(priced.lineItems.some((i) => i.label.includes('Duplex'))).toBe(true);
  });

  it('7b. verify the OLD bug: full pageCount would have priced 200 pages, not 5', () => {
    // With the bug (pages = file.pageCount = 200), price would be
    // 200 × ₹5 = 100000 paise (before bulk discount). With the fix,
    // 5 × ₹5 = 2500 paise (no bulk — under the 100-page threshold).
    const bugPrice = priceFile(makeInput({ pages: 200, colorMode: 'color' }));
    const fixedPrice = priceFile(makeInput({ pages: 5, colorMode: 'color' }));
    expect(fixedPrice.totalPaise).toBe(2500);
    expect(bugPrice.totalPaise).toBeGreaterThan(fixedPrice.totalPaise);
    // And the fixed price is NOT in the bulk-discount band (would be 95000
    // after the 5% bulk discount).
    expect(fixedPrice.totalPaise).not.toBe(95000);
  });
});

describe('parsePageRange — invalid inputs rejected', () => {
  it('8. rejects "0" (below the 1-page minimum)', () => {
    expect(parsePageRange('0', 10)).toBeNull();
    const r = resolveBillablePages('0', 10);
    expect('error' in r).toBe(true);
  });

  it('9. rejects "999" when maxPages=10 (out of range)', () => {
    expect(parsePageRange('999', 10)).toBeNull();
    const r = resolveBillablePages('999', 10);
    expect('error' in r).toBe(true);
  });

  it('10. rejects reversed range "5-3"', () => {
    expect(parsePageRange('5-3', 10)).toBeNull();
    const r = resolveBillablePages('5-3', 10);
    expect('error' in r).toBe(true);
  });

  it('11. rejects malformed "1-2-3"', () => {
    expect(parsePageRange('1-2-3', 10)).toBeNull();
    const r = resolveBillablePages('1-2-3', 10);
    expect('error' in r).toBe(true);
  });

  it('12. rejects negative page numbers (e.g. "-1")', () => {
    expect(parsePageRange('-1', 10)).toBeNull();
    expect(parsePageRange('-1-5', 10)).toBeNull();
  });

  it('12b. rejects non-numeric tokens', () => {
    expect(parsePageRange('abc', 10)).toBeNull();
    expect(parsePageRange('1,a,3', 10)).toBeNull();
    expect(parsePageRange('', 10)).toBeNull();
  });

  it('13. rejects a range that references pages beyond the document ("1-15" when maxPages=10)', () => {
    expect(parsePageRange('1-15', 10)).toBeNull();
    const r = resolveBillablePages('1-15', 10);
    expect('error' in r).toBe(true);
    // The error message must mention the actual page count for clarity.
    if ('error' in r) {
      expect(r.error).toContain('10-page');
      expect(r.error).toContain('1 and 10');
    }
  });
});

describe('parsePageRange — backward compatibility', () => {
  it('14. existing orders with pageRange = null fall back to file.pageCount', () => {
    // A pre-page-selection order: pageRange is null, pageCount is 200 →
    // billablePages must be 200 (no regression in the legacy pricing path).
    const r = resolveBillablePages(null, 200);
    if ('error' in r) throw new Error('legacy null pageRange must not error');
    expect(r.billablePages).toBe(200);
    expect(r.selectedPages).toBeNull();
  });

  it('14b. empty-string pageRange also falls back to file.pageCount', () => {
    const r = resolveBillablePages('', 200);
    if ('error' in r) throw new Error('empty pageRange must not error');
    expect(r.billablePages).toBe(200);
  });

  it('14c. unknown pageCount + null range → defaults to 1 page (non-paginated file)', () => {
    // An image upload where the server has no pageCount. The historical
    // behaviour was `file.pageCount ?? 1` — preserve it exactly.
    const r = resolveBillablePages(null, null);
    if ('error' in r) throw new Error('null range + null count must not error');
    expect(r.billablePages).toBe(1);
  });

  it('14d. unknown pageCount + supplied range → rejected (cannot validate)', () => {
    // A range was supplied but we don't know the document's length — reject
    // rather than silently bill for an arbitrary number of pages.
    const r = resolveBillablePages('1-5', null);
    expect('error' in r).toBe(true);
  });
});

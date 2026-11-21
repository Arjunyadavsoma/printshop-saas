import { describe, expect, it } from 'vitest';
import { parsePageRange, allPages, oddPages, evenPages, formatPageRange, RangeParseError } from './page-range';
import { planPrintJob, choosePrinter } from './planner';
import type { PlannerSpec, PlannerPrinter, PageMode } from './planner';
import { computeOrderPrice, pickSlab, makeRateFor } from '@/lib/pricing/price-engine';
import type { RuleLike, AddonLike } from '@/lib/pricing/price-engine';
import { assertOrderTransition, canTransition, shouldMarkReady, assertTaskTransition } from '@/lib/orders/state-machine';
import { buildUpiIntentUrl, isValidUpiId, isValidUtr, assertValidUpiId } from '@/lib/payments/upi';

/**
 * Phase 3 — the brief §5.3 required unit-test matrix plus the §10 unit list
 * (range parser, price engine, state machine, UPI builder). All pure.
 */

// ── fixtures ─────────────────────────────────────────────────────────────

function modes(pageCount: number, colorPages: number[] = [], skips: number[] = []): PageMode[] {
  return Array.from({ length: pageCount }, (_, i) => ({
    page: i + 1,
    mode: skips.includes(i + 1) ? 'skip' : colorPages.includes(i + 1) ? 'color' : 'bw',
  }));
}

const A4_COLOR: PlannerPrinter = {
  id: 'p-color', supportsColor: true, supportsDuplex: true, paperSizes: ['A4'],
  isDefaultColor: true, isDefaultBw: false, status: 'ONLINE', enabled: true,
};
const A4_BW: PlannerPrinter = {
  id: 'p-bw', supportsColor: false, supportsDuplex: true, paperSizes: ['A4'],
  isDefaultColor: false, isDefaultBw: true, status: 'ONLINE', enabled: true,
};
const TWO_PRINTERS = [A4_COLOR, A4_BW];

const RATES = makeRateFor([
  { paperSize: 'A4', paperType: 'PLAIN', colorMode: 'BW', sides: 'SINGLE', active: true, slabs: [{ minPages: 1, perPagePaise: 200 }, { minPages: 51, perPagePaise: 150 }] },
  { paperSize: 'A4', paperType: 'PLAIN', colorMode: 'BW', sides: 'DOUBLE', active: true, slabs: [{ minPages: 1, perPagePaise: 180 }, { minPages: 51, perPagePaise: 130 }] },
  { paperSize: 'A4', paperType: 'PLAIN', colorMode: 'COLOR', sides: 'SINGLE', active: true, slabs: [{ minPages: 1, perPagePaise: 1000 }, { minPages: 21, perPagePaise: 800 }] },
  { paperSize: 'A4', paperType: 'PLAIN', colorMode: 'COLOR', sides: 'DOUBLE', active: true, slabs: [{ minPages: 1, perPagePaise: 900 }] },
]);

function spec(overrides: Partial<PlannerSpec> & { pageCount?: number; colorPages?: number[]; skips?: number[] }): PlannerSpec {
  const { pageCount = 10, colorPages = [], skips = [], ...rest } = overrides;
  return {
    pageModes: modes(pageCount, colorPages, skips),
    copies: 1,
    sides: 'SINGLE',
    pagesPerSheet: 1,
    paperSize: 'A4',
    paperType: 'PLAIN',
    collate: true,
    ...rest,
  };
}

function plan(overrides: Partial<PlannerSpec> & { pageCount?: number; colorPages?: number[]; skips?: number[] }, printers: PlannerPrinter[] = TWO_PRINTERS, colorSheetBilling: 'PER_PAGE_ACTUAL' | 'SHEET_AS_COLOR' = 'PER_PAGE_ACTUAL') {
  return planPrintJob({ spec: spec(overrides), printers, rateFor: RATES, colorSheetBilling });
}

// ── 1. range parser ──────────────────────────────────────────────────────

describe('page-range parser', () => {
  it('parses ranges, singles, mixed, de-duplicates and sorts', () => {
    expect(parsePageRange('1-5, 8, 10-12', 12)).toEqual([1, 2, 3, 4, 5, 8, 10, 11, 12]);
    expect(parsePageRange('3,3,3', 12)).toEqual([3]);
    expect(parsePageRange('12, 1', 12)).toEqual([1, 12]);
  });
  it('names the exact invalid page', () => {
    try {
      parsePageRange('1-5, 14', 12);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RangeParseError);
      expect((e as RangeParseError).invalidPage).toBe(14);
      expect((e as Error).message).toContain('Page 14 is out of range');
      expect((e as Error).message).toContain('12 pages');
    }
  });
  it('rejects reversed ranges, zeros and garbage', () => {
    expect(() => parsePageRange('9-4', 12)).toThrow(/reversed/);
    expect(() => parsePageRange('0', 12)).toThrow(/start at 1/);
    expect(() => parsePageRange('1;2', 12)).toThrow(/may only contain/);
    expect(() => parsePageRange('', 12)).toThrow(/Enter a page range/);
  });
  it('shortcut helpers + human formatting round-trip', () => {
    expect(allPages(3)).toEqual([1, 2, 3]);
    expect(oddPages(6)).toEqual([1, 3, 5]);
    expect(evenPages(6)).toEqual([2, 4, 6]);
    expect(formatPageRange([1, 2, 3, 5, 8, 9, 10])).toBe('1-3, 5, 8-10');
  });
});

// ── 2. planner — the §5.3 matrix ─────────────────────────────────────────

describe('planner: all-BW / all-color → single FULL task', () => {
  it('all-BW doc → one full task on the B&W printer', () => {
    const p = plan({ pageCount: 10, colorPages: [] });
    expect(p.tasks).toHaveLength(1);
    const t = p.tasks[0]!;
    expect(t.kind).toBe('full');
    expect(t.colorMode).toBe('BW');
    expect(t.printerId).toBe('p-bw');
    expect(t.sourcePages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.pricing.subtotalPaise).toBe(10 * 200); // ₹20.00
  });
  it('all-color doc → one full task on the color printer', () => {
    const p = plan({ pageCount: 4, colorPages: [1, 2, 3, 4] });
    expect(p.tasks[0]!.kind).toBe('full');
    expect(p.tasks[0]!.colorMode).toBe('COLOR');
    expect(p.tasks[0]!.printerId).toBe('p-color');
    expect(p.pricing.subtotalPaise).toBe(4 * 1000);
  });
});

describe('planner: mixed documents (the DoD example)', () => {
  it('10 pages, 3 & 7 color → COLOR_SET(3,7) + BW_SET(rest), correct printers, correct price', () => {
    const p = plan({ pageCount: 10, colorPages: [3, 7] });
    expect(p.tasks).toHaveLength(2);
    const color = p.tasks.find(t => t.kind === 'color_set')!;
    const bw = p.tasks.find(t => t.kind === 'bw_set')!;
    expect(color.sourcePages).toEqual([3, 7]);
    expect(color.printerId).toBe('p-color');
    expect(bw.sourcePages).toEqual([1, 2, 4, 5, 6, 8, 9, 10]);
    expect(bw.printerId).toBe('p-bw');
    expect(color.setLabel).toBe('Color pages: 3, 7');
    expect(bw.setLabel).toBe('B&W pages: 1-2, 4-6, 8-10');
    // price: 8×200 + 2×1000 = 1600 + 2000 = ₹36.00
    expect(p.pricing.subtotalPaise).toBe(3600);
  });

  it('mixed single-sided with SKIP pages excludes them everywhere', () => {
    const p = plan({ pageCount: 10, colorPages: [3], skips: [5, 6] });
    const bw = p.tasks.find(t => t.kind === 'bw_set')!;
    expect(bw.sourcePages).toEqual([1, 2, 4, 7, 8, 9, 10]);
    expect(p.selectedPages).toEqual([1, 2, 3, 4, 7, 8, 9, 10]);
    expect(p.pricing.subtotalPaise).toBe(7 * 200 + 1000);
  });

  it('1-page document: color → single task, price 1×rate', () => {
    const p = plan({ pageCount: 1, colorPages: [1] });
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]!.colorMode).toBe('COLOR');
    expect(p.pricing.subtotalPaise).toBe(1000);
  });
});

describe('planner: duplex', () => {
  it('mixed double-sided NEVER splits a sheet: pages 3 & 7 drag their pair-sheets to color', () => {
    // 10 pages, duplex 1-up: sheets are (1,2) (3,4) (5,6) (7,8) (9,10)
    const p = plan({ pageCount: 10, colorPages: [3, 7], sides: 'DOUBLE' });
    const color = p.tasks.find(t => t.colorMode === 'COLOR')!;
    const bw = p.tasks.find(t => t.colorMode === 'BW')!;
    expect(color.sheets.map(s => [...s.front, ...s.back])).toEqual([[3, 4], [7, 8]]);
    expect(bw.sheets.map(s => [...s.front, ...s.back])).toEqual([[1, 2], [5, 6], [9, 10]]);
    // no page appears in both sets
    const all = [...color.sourcePages, ...bw.sourcePages];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('mixed double-sided with odd page count pads the last back side blank', () => {
    // 9 pages duplex: sides = [1],[2],[3]...[9]; sheets (1,2)(3,4)(5,6)(7,8)(9,—)
    const p = plan({ pageCount: 9, colorPages: [9], sides: 'DOUBLE' });
    const color = p.tasks.find(t => t.colorMode === 'COLOR')!;
    const last = color.sheets[0]!;
    expect(last.front).toEqual([9]);
    expect(last.back).toEqual([]); // blank back — padding keeps pairing correct
    // the PDF builder renders the blank back (task-pdf.ts)
  });

  it('SHEET_AS_COLOR vs PER_PAGE_ACTUAL totals differ per the shop rule', () => {
    // 4 pages duplex, page 2 color: sheets (1,2)(3,4) → 1 color sheet, 1 bw sheet
    const s = { pageCount: 4, colorPages: [2], sides: 'DOUBLE' as const };
    const perPage = plan(s, TWO_PRINTERS, 'PER_PAGE_ACTUAL');
    // PER_PAGE_ACTUAL: 1 color page + 3 bw pages (per-page rates)
    expect(perPage.pricing.lines.find(l => l.colorMode === 'COLOR')!.pages).toBe(1);
    expect(perPage.pricing.lines.find(l => l.colorMode === 'BW')!.pages).toBe(3);
    expect(perPage.pricing.subtotalPaise).toBe(900 + 3 * 180); // DOUBLE rules: color 900, bw 180
    const sheetAs = plan(s, TWO_PRINTERS, 'SHEET_AS_COLOR');
    // SHEET_AS_COLOR: 1 color SHEET + 1 bw SHEET (sheet counts as units)
    expect(sheetAs.pricing.lines.find(l => l.colorMode === 'COLOR')!.pages).toBe(1);
    expect(sheetAs.pricing.lines.find(l => l.colorMode === 'BW')!.pages).toBe(1);
    expect(sheetAs.pricing.subtotalPaise).toBe(900 + 180);
  });
});

describe('planner: N-up', () => {
  it('2-up mixed single-sided: sheet color = any page on it color', () => {
    // 10 pages 2-up: sides (1,2)(3,4)(5,6)(7,8)(9,10); page 3 color → sheet 2 color
    const p = plan({ pageCount: 10, colorPages: [3], pagesPerSheet: 2 });
    const color = p.tasks.find(t => t.colorMode === 'COLOR')!;
    expect(color.sheets.map(s => s.front)).toEqual([[3, 4]]);
    const bw = p.tasks.find(t => t.colorMode === 'BW')!;
    expect(bw.sheetCount).toBe(4);
  });

  it('4-up with mixed colors groups correctly and prices N-up pages', () => {
    // 16 pages 4-up: sides (1-4)(5-8)(9-12)(13-16); page 9 color → sheet 3 color
    const p = plan({ pageCount: 16, colorPages: [9], pagesPerSheet: 4 });
    const color = p.tasks.find(t => t.colorMode === 'COLOR')!;
    expect(color.sheets.map(s => s.front)).toEqual([[9, 10, 11, 12]]);
    expect(p.pricing.subtotalPaise).toBe(15 * 200 + 1 * 1000); // PER_PAGE_ACTUAL: page 9 color, 10-12 still bw
  });

  it('duplex + 2-up: a physical sheet is front(2)+back(2); any color page colors the sheet', () => {
    // 8 pages, duplex 2-up: sides (1,2)(3,4)(5,6)(7,8); sheets: (1,2 | 3,4) (5,6 | 7,8)
    const p = plan({ pageCount: 8, colorPages: [4], sides: 'DOUBLE', pagesPerSheet: 2 });
    const color = p.tasks.find(t => t.colorMode === 'COLOR')!;
    expect(color.sheets).toHaveLength(1);
    expect(color.sheets[0]!.front).toEqual([1, 2]);
    expect(color.sheets[0]!.back).toEqual([3, 4]); // page 4 is on the BACK side
    expect(color.sheetCount).toBe(1);
  });
});

describe('planner: copies + collate', () => {
  it('copies carry into tasks and multiply the price', () => {
    const p = plan({ pageCount: 10, colorPages: [3, 7], copies: 3 });
    expect(p.tasks.every(t => t.copies === 3)).toBe(true);
    expect(p.pricing.subtotalPaise).toBe(3600 * 3);
  });

  it('collate ON + split across printers → warning + guide needed', () => {
    const p = plan({ pageCount: 10, colorPages: [3, 7], copies: 2, collate: true });
    expect(p.warnings.some(w => /merge sets by hand/.test(w))).toBe(true);
    expect(p.collationGuide.needed).toBe(true);
    expect(p.collationGuide.copies).toBe(2);
  });

  it('collationGuide gives the interleaved assembly steps in page order', () => {
    const p = plan({ pageCount: 10, colorPages: [3, 7] });
    expect(p.collationGuide.steps).toEqual([
      { colorMode: 'BW', pages: '1-2' },
      { colorMode: 'COLOR', pages: '3' },
      { colorMode: 'BW', pages: '4-6' },
      { colorMode: 'COLOR', pages: '7' },
      { colorMode: 'BW', pages: '8-10' },
    ]);
  });
});

describe('planner: printer routing edge cases', () => {
  it('no color printer available → color task still created, warning set', () => {
    const p = plan({ pageCount: 10, colorPages: [3] }, [A4_BW]);
    const color = p.tasks.find(t => t.colorMode === 'COLOR')!;
    expect(color.printerId).toBeNull();
    expect(color.warning).toMatch(/No online color printer/);
    expect(p.warnings).toHaveLength(1);
    expect(p.tasks).toHaveLength(2); // both tasks exist
  });

  it('paper size unsupported → task queued with warning', () => {
    const p = planPrintJob({
      spec: spec({ pageCount: 2, paperSize: 'A3' }),
      printers: TWO_PRINTERS,
      rateFor: (size, cm, sides) => RATES(size, cm, sides, 'PLAIN'),
    });
    expect(p.tasks.every(t => t.printerId === null)).toBe(true);
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it('paused/error printers are not eligible', () => {
    const paused = { ...A4_COLOR, status: 'PAUSED' };
    const r = choosePrinter([paused], 'COLOR', 'A4', false);
    expect(r.printerId).toBeNull();
  });

  it('BW prefers the B&W-only printer, falls back to a color printer set to grayscale', () => {
    const colorOnly = { ...A4_COLOR, isDefaultBw: false };
    const r = choosePrinter([colorOnly], 'BW', 'A4', false);
    expect(r.printerId).toBe('p-color'); // fallback: color printer prints B&W
  });

  it('duplex requires supportsDuplex', () => {
    const noDuplex = { ...A4_BW, supportsDuplex: false };
    const r = choosePrinter([noDuplex], 'BW', 'A4', true);
    expect(r.printerId).toBeNull();
  });
});

// ── 3. price engine: slabs, add-ons, urgent ─────────────────────────────

describe('price engine', () => {
  const rules: RuleLike[] = [
    { paperSize: 'A4', paperType: 'PLAIN', colorMode: 'BW', sides: 'SINGLE', active: true, slabs: [{ minPages: 1, perPagePaise: 200 }, { minPages: 50, perPagePaise: 150 }, { minPages: 100, perPagePaise: 120 }] },
  ];

  it('slab boundaries: exactly at, one below, one above', () => {
    expect(pickSlab(rules[0]!.slabs, 49)).toBe(200);   // one below 50
    expect(pickSlab(rules[0]!.slabs, 50)).toBe(150);   // exactly at
    expect(pickSlab(rules[0]!.slabs, 99)).toBe(150);   // one below 100
    expect(pickSlab(rules[0]!.slabs, 100)).toBe(120);  // exactly at
    expect(pickSlab(rules[0]!.slabs, 101)).toBe(120);  // above
  });

  it('slab is chosen on the ORDER-LEVEL total (50 bw pages spread over 2 files)', () => {
    const planA = planPrintJob({ spec: spec({ pageCount: 30 }), printers: [], rateFor: () => 200 });
    const planB = planPrintJob({ spec: spec({ pageCount: 20 }), printers: [], rateFor: () => 200 });
    const price = computeOrderPrice({
      filePricings: [planA.pricing, planB.pricing],
      rules, addons: [], totalSheets: 50, totalCopies: 1, urgent: false, urgentSurchargePaise: 0,
    });
    // 50 pages total → 150/page (one below the boundary would be 200)
    expect(price.lines[0]!.perPagePaise).toBe(150);
    expect(price.subtotalPaise).toBe(50 * 150);
  });

  it('missing rule → ruleMissing true, subtotal null, honest quote failure', () => {
    const planA = planPrintJob({ spec: spec({ pageCount: 3, paperSize: 'A3' }), printers: [], rateFor: () => null });
    const price = computeOrderPrice({
      filePricings: [planA.pricing], rules, addons: [], totalSheets: 3, totalCopies: 1, urgent: false, urgentSurchargePaise: 0,
    });
    expect(price.ruleMissing).toBe(true);
    expect(price.subtotalPaise).toBeNull();
    expect(price.totalPaise).toBeNull();
  });

  it('add-ons: PER_ORDER once, PER_COPY × copies, PER_SHEET × sheets; urgent surcharge', () => {
    const planA = planPrintJob({ spec: spec({ pageCount: 10, copies: 2 }), printers: [], rateFor: () => 200 });
    const staple: AddonLike = { id: 'a1', kind: 'staple', label: 'Staple', pricePaise: 1000, pricingUnit: 'PER_ORDER' };
    const spiral: AddonLike = { id: 'a2', kind: 'spiral_bind', label: 'Spiral', pricePaise: 3000, pricingUnit: 'PER_COPY' };
    const laminate: AddonLike = { id: 'a3', kind: 'laminate', label: 'Laminate', pricePaise: 2000, pricingUnit: 'PER_SHEET' };
    const price = computeOrderPrice({
      filePricings: [planA.pricing], rules,
      addons: [{ addon: staple }, { addon: spiral }, { addon: laminate }],
      totalSheets: 10, totalCopies: 2, urgent: true, urgentSurchargePaise: 2500,
    });
    expect(price.subtotalPaise).toBe(200 * 10 * 2); // 10 bw pages × ₹2 × 2 copies
    expect(price.addonsPaise).toBe(1000 + 3000 * 2 + 2000 * 10);
    expect(price.urgentPaise).toBe(2500);
    expect(price.totalPaise).toBe(4000 + 1000 + 6000 + 20000 + 2500);
  });
});

// ── 4. state machines ────────────────────────────────────────────────────

describe('order state machine', () => {
  it('happy path UPI_THEN_PRINT', () => {
    const path = ['draft', 'awaiting_payment', 'payment_submitted', 'paid', 'queued', 'printing', 'partially_printed', 'ready', 'collected'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });
  it('PRINT_THEN_PAY path goes ready → paid_on_pickup → collected', () => {
    expect(canTransition('draft', 'queued')).toBe(true);
    expect(canTransition('ready', 'paid_on_pickup')).toBe(true);
    expect(canTransition('paid_on_pickup', 'collected')).toBe(true);
  });
  it('illegal transitions throw (collected is terminal; cannot skip payment)', () => {
    expect(() => assertOrderTransition('collected', 'ready')).toThrow(/Illegal order transition/);
    expect(() => assertOrderTransition('awaiting_payment', 'queued')).toThrow(/Illegal order transition/);
    expect(canTransition('cancelled', 'queued')).toBe(false);
  });
  it('customer cancels only before PRINTING', () => {
    expect(canTransition('queued', 'cancelled')).toBe(true);
    expect(canTransition('printing', 'cancelled')).toBe(false);
    expect(canTransition('ready', 'cancelled')).toBe(false);
  });
  it('unpaid orders expire; READY requires ALL tasks printed', () => {
    expect(canTransition('awaiting_payment', 'expired')).toBe(true);
    expect(shouldMarkReady(['printed', 'printed'])).toBe(true);
    expect(shouldMarkReady(['printed', 'spooled'])).toBe(false);
    expect(shouldMarkReady([])).toBe(false);
  });
});

describe('task state machine', () => {
  it('device lifecycle: queued→dispatched→received→printing→spooled→printed', () => {
    const path = ['queued', 'dispatched', 'received', 'printing', 'spooled', 'printed'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertTaskTransition(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });
  it('UNCERTAIN is terminal (never auto-retried)', () => {
    expect(() => assertTaskTransition('spooled', 'uncertain')).not.toThrow();
    expect(() => assertTaskTransition('uncertain', 'queued')).toThrow();
    expect(() => assertTaskTransition('uncertain', 'printed')).toThrow();
  });
  it('failed can retry to queued (attempt+1 handled by dispatcher)', () => {
    expect(() => assertTaskTransition('failed', 'queued')).not.toThrow();
  });
});

// ── 5. UPI builder ───────────────────────────────────────────────────────

describe('UPI intent builder', () => {
  it('builds the intent link from integer paise (no floats)', () => {
    const url = buildUpiIntentUrl({ payeeUpi: 'saisxerox@ybl', payeeName: 'Shri Sai Xerox', amountPaise: 6450, orderShortId: '4182' });
    expect(url).toContain('upi://pay?');
    expect(url).toContain('pa=saisxerox%40ybl');
    expect(url).toContain('am=64.50');
    expect(url).toContain('cu=INR');
    expect(url).toContain('tn=4182');
  });
  it('exact rupees pad paise correctly (₹36.00)', () => {
    const url = buildUpiIntentUrl({ payeeUpi: 'aa@bb', payeeName: 'A', amountPaise: 3600, orderShortId: 'x' });
    expect(url).toContain('am=36.00');
  });
  it('validates VPA and UTR honestly', () => {
    expect(isValidUpiId('saisxerox@ybl')).toBe(true);
    expect(isValidUpiId('not-an-upi')).toBe(false);
    expect(() => assertValidUpiId('bad upi')).toThrow(/does not look valid/);
    expect(isValidUtr('441234567890')).toBe(true);
    expect(isValidUtr('44123456789')).toBe(false);
    expect(isValidUtr('44123456789a')).toBe(false);
  });
  it('rejects non-positive amounts', () => {
    expect(() => buildUpiIntentUrl({ payeeUpi: 'aa@bb', payeeName: 'A', amountPaise: 0, orderShortId: 'x' })).toThrow(/positive/);
  });
});

// ── 6. performance: 500-page document < 3 s ──────────────────────────────

describe('planner performance', () => {
  it('500-page mixed doc plans in < 3 s (every 10th page color, 2-up duplex, 3 copies)', () => {
    const colorPages = Array.from({ length: 50 }, (_, i) => i * 10 + 3);
    const s = spec({ pageCount: 500, colorPages, sides: 'DOUBLE', pagesPerSheet: 2, copies: 3 });
    const t0 = performance.now();
    const p = plan(s);
    const ms = performance.now() - t0;
    expect(p.sheets.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(3000);
    // deterministic: color sheets exactly where expected
    const colorSheets = p.sheets.filter(sh => sh.colorMode === 'COLOR').length;
    expect(colorSheets).toBeGreaterThan(0);
  });
});

/**
 * Price engine (Phase 3, brief §5.3 j) — PURE, integer paise end to end,
 * computed on the SERVER only. The quote endpoint and checkout both call
 * this; the client never computes money.
 *
 * Slab selection: per (paperSize, colorMode, sides, paperType) group, the
 * slab is chosen on the TOTAL logical pages of that group ACROSS THE WHOLE
 * ORDER (per copy), then the line is rate × pages × copies — rounded only
 * once, which for integers is exact.
 */
import type { PriceLine, PricingBreakdown } from '@/lib/printing/planner';

export type Slab = { minPages: number; perPagePaise: number };

export type RuleLike = {
  paperSize: string;
  paperType: string;
  colorMode: 'BW' | 'COLOR';
  sides: 'SINGLE' | 'DOUBLE';
  slabs: Slab[];
  active: boolean;
};

export type AddonLike = {
  id: string;
  kind: string;
  label: string;
  pricePaise: number;
  pricingUnit: 'PER_ORDER' | 'PER_COPY' | 'PER_SHEET';
};

/** The slab for `pages`: the one with the largest minPages ≤ pages. */
export function pickSlab(slabs: Slab[], pages: number): number | null {
  const sorted = [...slabs].sort((a, b) => a.minPages - b.minPages);
  let rate: number | null = null;
  for (const s of sorted) {
    if (pages >= s.minPages) rate = s.perPagePaise;
  }
  return rate;
}

export function makeRateFor(rules: RuleLike[]) {
  return (paperSize: string, colorMode: 'BW' | 'COLOR', sides: 'SINGLE' | 'DOUBLE', paperType: string): number | null => {
    const rule = rules.find(r =>
      r.active
      && r.paperSize === paperSize
      && r.colorMode === colorMode
      && r.sides === sides
      && r.paperType === paperType);
    if (!rule) return null;
    return rule.slabs[0]?.perPagePaise ?? null; // per-file planning uses the base slab
  };
}

export type OrderPriceInput = {
  /** Per-file planner output (pricing.lines with logical page counts). */
  filePricings: PricingBreakdown[];
  rules: RuleLike[];
  /** Add-ons selected for the order. */
  addons: Array<{ addon: AddonLike; quantity?: number }>;
  /** Total physical sheets across the order (for PER_SHEET add-ons). */
  totalSheets: number;
  /** Total copies across the order (for PER_COPY add-ons). */
  totalCopies: number;
  urgent: boolean;
  urgentSurchargePaise: number;
};

export type OrderPrice = {
  lines: PriceLine[];
  subtotalPaise: number | null;
  addonsPaise: number;
  addonsDetail: Array<{ label: string; unit: string; quantity: number; unitPaise: number; linePaise: number }>;
  urgentPaise: number;
  totalPaise: number | null;
  ruleMissing: boolean;
};

export function computeOrderPrice(input: OrderPriceInput): OrderPrice {
  const { filePricings, rules, addons, totalSheets, totalCopies, urgent, urgentSurchargePaise } = input;

  // 1) group pages per (size, colorMode, sides, type) across ALL files
  const groups = new Map<string, PriceLine>();
  for (const pricing of filePricings) {
    for (const line of pricing.lines) {
      const key = `${line.paperSize}|${line.colorMode}|${line.sides}|${line.paperType}`;
      const existing = groups.get(key);
      if (existing) existing.pages += line.pages;
      else groups.set(key, { ...line });
    }
  }

  // 2) rate each group by the ORDER-LEVEL slab; price = rate × pages × copies
  //    (per-file copies summed; every group line rounded exactly once)
  const lines: PriceLine[] = [...groups.values()].map(g => {
    const rule = rules.find(r =>
      r.active
      && r.paperSize === g.paperSize
      && r.colorMode === g.colorMode
      && r.sides === g.sides
      && r.paperType === g.paperType);
    if (!rule) {
      return { ...g, perPagePaise: null, linePaise: null, ruleMissing: true };
    }
    const rate = pickSlab(rule.slabs, g.pages);
    return {
      ...g,
      perPagePaise: rate,
      linePaise: rate === null ? null : rate * g.pages * g.copies,
      ruleMissing: rate === null,
    };
  });

  const subtotal = lines.every(l => l.linePaise !== null)
    ? lines.reduce((sum, l) => sum + (l.linePaise ?? 0), 0)
    : null;

  // 3) add-ons — integer math per unit type
  const addonsDetail: OrderPrice['addonsDetail'] = [];
  let addonsPaise = 0;
  for (const sel of addons) {
    const { addon } = sel;
    const quantity = sel.quantity ?? 1;
    const unit = addon.pricingUnit;
    const qty = unit === 'PER_ORDER' ? 1 : unit === 'PER_COPY' ? Math.max(1, totalCopies) : Math.max(1, totalSheets);
    const line = addon.pricePaise * qty;
    addonsPaise += line;
    addonsDetail.push({ label: addon.label, unit, quantity: qty, unitPaise: addon.pricePaise, linePaise: line });
  }

  // 4) urgent surcharge
  const urgentPaise = urgent ? urgentSurchargePaise : 0;

  const total = subtotal === null ? null : subtotal + addonsPaise + urgentPaise;

  return {
    lines,
    subtotalPaise: subtotal,
    addonsPaise,
    addonsDetail,
    urgentPaise,
    totalPaise: total,
    ruleMissing: lines.some(l => l.ruleMissing),
  };
}

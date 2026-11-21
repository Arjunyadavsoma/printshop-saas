/**
 * PrintPlanner (Phase 3, brief §5.3) — PURE function, no IO, 100% unit
 * tested. Turns one normalized file + its PrintSpec + the shop's printers
 * into a PrintPlan: the sheet model, the COLOR_SET/BW_SET task split, the
 * printer routing, the pricing input and the collation guide.
 *
 * Model:
 *   logical page (customer page) → side (N-up group, pagesPerSheet pages)
 *   → physical sheet (front+back when duplex) → tasks by sheet color mode.
 * A sheet's mode is COLOR if ANY page on it is color — never split a
 * physical sheet across two printers (brief §12 Definition of Done).
 */

export type ModeValue = 'color' | 'bw' | 'skip';
/** One entry per customer page — the source of truth (brief §3 PrintSpec). */
export type PageMode = { page: number; mode: ModeValue };
export type TaskKind = 'color_set' | 'bw_set' | 'full';

export type PlannerSpec = {
  /** Page modes per customer page (1-based). Source of truth. */
  pageModes: PageMode[];
  copies: number;
  sides: 'SINGLE' | 'DOUBLE';
  /** Which edge duplex flips on — display only, does not change math. */
  duplexEdge?: 'long' | 'short';
  pagesPerSheet: 1 | 2 | 4 | 6 | 9;
  paperSize: string;
  paperType: string;
  collate: boolean;
};

export type PlannerPrinter = {
  id: string;
  supportsColor: boolean;
  supportsDuplex: boolean;
  paperSizes: string[];
  isDefaultColor: boolean;
  isDefaultBw: boolean;
  status: string;
  enabled: boolean;
};

export type PlannedSheet = {
  /** Customer page numbers on the FRONT side, in order (N-up group). */
  front: number[];
  /** Customer page numbers on the BACK side ([] when single-sided). */
  back: number[];
  colorMode: 'COLOR' | 'BW';
};

export type PlannedTask = {
  kind: TaskKind;
  sheets: PlannedSheet[];
  /** All customer pages in this task, in print order. */
  sourcePages: number[];
  sheetCount: number;
  colorMode: 'COLOR' | 'BW';
  copies: number;
  paperSize: string;
  duplex: boolean;
  pagesPerSheet: number;
  setLabel: string;
  printerId: string | null;
  /** Eligible-printer warnings folded into plan.warnings — kept per task too. */
  warning?: string;
};

export type PriceLine = {
  paperSize: string;
  colorMode: 'BW' | 'COLOR';
  sides: 'SINGLE' | 'DOUBLE';
  paperType: string;
  /** Billable units (pages for single-sided, sheets for duplex billing). */
  pages: number;
  copies: number;
  perPagePaise: number | null;
  linePaise: number | null; // null when no matching rule
  ruleMissing?: boolean;
};

export type PricingBreakdown = {
  lines: PriceLine[];
  subtotalPaise: number | null;
  ruleMissing: boolean;
};

export type CollationStep = { colorMode: 'COLOR' | 'BW'; pages: string };

export type PrintPlan = {
  selectedPages: number[];
  sheets: PlannedSheet[];
  tasks: PlannedTask[];
  warnings: string[];
  /** Per-copy assembly steps for the shopkeeper's slip. */
  collationGuide: {
    needed: boolean;
    copies: number;
    steps: CollationStep[];
  };
  pricing: PricingBreakdown;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatPages(pages: number[]): string {
  if (pages.length === 0) return '';
  const runs: Array<[number, number]> = [];
  let start = pages[0]!;
  let prev = start;
  for (const p of pages.slice(1)) {
    if (p === prev + 1) { prev = p; continue; }
    runs.push([start, prev]);
    start = p; prev = p;
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

/** Choose the printer for a task. Pure. Only ONLINE, enabled printers with
 *  the right capabilities are eligible (brief §5.3 f). */
export function choosePrinter(
  printers: PlannerPrinter[],
  mode: 'COLOR' | 'BW',
  paperSize: string,
  duplex: boolean,
): { printerId: string | null; warning?: string } {
  const eligible = printers.filter(p =>
    p.enabled
    && p.status === 'ONLINE'
    && p.paperSizes.includes(paperSize)
    && (mode === 'BW' || p.supportsColor)
    && (!duplex || p.supportsDuplex));
  if (eligible.length === 0) {
    // Still create the task (PENDING) and warn — brief §5.3 f.
    return {
      printerId: null,
      warning: mode === 'COLOR'
        ? `No online color printer supports ${paperSize}${duplex ? ' with duplex' : ''} — the color task stays queued until one is available.`
        : `No online printer supports ${paperSize}${duplex ? ' with duplex' : ''} — the task stays queued until one is available.`,
    };
  }
  let pick = eligible.find(p => mode === 'COLOR' ? p.isDefaultColor : p.isDefaultBw && !p.supportsColor);
  if (!pick && mode === 'BW') pick = eligible.find(p => !p.supportsColor); // prefer B&W-only
  if (!pick) pick = eligible.find(p => mode === 'COLOR' ? p.supportsColor : true);
  if (!pick) pick = eligible[0]!;
  return { printerId: pick.id };
}

export function planPrintJob(input: {
  spec: PlannerSpec;
  printers: PlannerPrinter[];
  /** Rule lookup per (size,colorMode,sides) — returns perPagePaise or null. */
  rateFor: (paperSize: string, colorMode: 'BW' | 'COLOR', sides: 'SINGLE' | 'DOUBLE', paperType: string) => number | null;
  /** PER_PAGE_ACTUAL | SHEET_AS_COLOR (duplex color billing). */
  colorSheetBilling?: 'PER_PAGE_ACTUAL' | 'SHEET_AS_COLOR';
}): PrintPlan {
  const { spec, printers, rateFor, colorSheetBilling = 'PER_PAGE_ACTUAL' } = input;
  const warnings: string[] = [];

  // a) resolve selected pages (SKIP removed; source of truth = pageModes)
  const selectedPages = spec.pageModes
    .filter(m => m.mode !== 'skip')
    .map(m => m.page)
    .sort((a, b) => a - b);

  const nUp = spec.pagesPerSheet;
  const duplex = spec.sides === 'DOUBLE';
  const copies = Math.max(1, Math.min(100, spec.copies));

  // b) group logical pages into sides, then physical sheets
  const sidesList = chunk(selectedPages, nUp);
  const pagesPerPhysicalSheet = duplex ? nUp * 2 : nUp;
  const sheetCount = Math.ceil(sidesList.length / (duplex ? 2 : 1));

  // c) sheet mode = COLOR if any page on the physical sheet is color
  const sheets: PlannedSheet[] = [];
  for (let s = 0; s < sheetCount; s++) {
    const front = sidesList[s * (duplex ? 2 : 1)] ?? [];
    const back = duplex ? (sidesList[s * 2 + 1] ?? []) : [];
    const allPages = [...front, ...back];
    const hasColor = allPages.some(p => spec.pageModes.find(m => m.page === p)?.mode === 'color');
    sheets.push({ front, back, colorMode: hasColor ? 'COLOR' : 'BW' });
  }

  // d) split sheets into sets, preserving original order
  const colorSheets = sheets.filter(s => s.colorMode === 'COLOR');
  const bwSheets = sheets.filter(s => s.colorMode === 'BW');

  // f/g) build tasks
  const tasks: PlannedTask[] = [];
  const mkTask = (kind: TaskKind, mode: 'COLOR' | 'BW', taskSheets: PlannedSheet[], allSheets: boolean): PlannedTask | null => {
    if (taskSheets.length === 0) return null;
    const sourcePages = taskSheets.flatMap(sh => [...sh.front, ...sh.back]);
    const routed = choosePrinter(printers, mode, spec.paperSize, duplex);
    if (routed.warning) warnings.push(routed.warning);
    const pagesLabel = formatPages(sourcePages);
    return {
      kind: allSheets ? 'full' : kind,
      sheets: taskSheets,
      sourcePages,
      sheetCount: taskSheets.length,
      colorMode: mode,
      copies,
      paperSize: spec.paperSize,
      duplex,
      pagesPerSheet: nUp,
      setLabel: allSheets
        ? `${formatPages(selectedPages) || 'all pages'}`
        : `${mode === 'COLOR' ? 'Color' : 'B&W'} pages: ${pagesLabel}`,
      printerId: routed.printerId,
      warning: routed.warning,
    };
  };

  if (colorSheets.length === 0 || bwSheets.length === 0) {
    const only = (colorSheets.length > 0 ? colorSheets : bwSheets)!;
    const mode = colorSheets.length > 0 ? 'COLOR' : 'BW';
    const t = mkTask('full', mode, only, true);
    if (t) tasks.push(t);
  } else {
    const colorTask = mkTask('color_set', 'COLOR', colorSheets, false);
    const bwTask = mkTask('bw_set', 'BW', bwSheets, false);
    if (colorTask) tasks.push(colorTask);
    if (bwTask) tasks.push(bwTask);
  }

  // h) collate warning when the doc is split across printers
  const splitAcrossPrinters = tasks.length > 1
    && new Set(tasks.map(t => t.printerId)).size > 1;
  if (splitAcrossPrinters && copies > 1 && spec.collate) {
    warnings.push('Copies are split across two printers — collate ON means the shopkeeper must merge sets by hand (see the assembly slip).');
  }

  // i) collation guide (per copy: the exact interleaving, in page order)
  const collationSteps: CollationStep[] = [];
  const interleaved: Array<{ colorMode: 'COLOR' | 'BW'; pages: number[] }> = [];
  for (const sh of sheets) {
    const prev = interleaved[interleaved.length - 1];
    if (prev && prev.colorMode === sh.colorMode) prev.pages.push(...sh.front, ...sh.back);
    else interleaved.push({ colorMode: sh.colorMode, pages: [...sh.front, ...sh.back] });
  }
  for (const seg of interleaved) {
    collationSteps.push({ colorMode: seg.colorMode, pages: formatPages(seg.pages) });
  }
  const collationNeeded = splitAcrossPrinters && copies > 1;

  // j) pricing lines — slab is chosen on the TOTAL pages of the group across
  //    the order; groups here are per-file (the caller sums files for the
  //    order-level slab). Integer paise; a line is rounded exactly once.
  const lines: PriceLine[] = [];
  const pushLine = (mode: 'COLOR' | 'BW', pages: number) => {
    if (pages === 0) return;
    const sides = duplex ? 'DOUBLE' : 'SINGLE';
    // SHEET_AS_COLOR: a duplex color-printed sheet is billed wholly as color
    // even if only one of its sides is color. PER_PAGE_ACTUAL: each page at
    // its own mode (the sheet still prints on the color printer).
    const rate = rateFor(spec.paperSize, mode, sides, spec.paperType);
    lines.push({
      paperSize: spec.paperSize,
      colorMode: mode,
      sides,
      paperType: spec.paperType,
      pages,
      copies,
      perPagePaise: rate,
      linePaise: rate === null ? null : rate * pages * copies,
      ruleMissing: rate === null,
    });
  };

  if (!duplex) {
    const bwPages = selectedPages.filter(p => spec.pageModes.find(m => m.page === p)?.mode !== 'color').length;
    const colorPages = selectedPages.length - bwPages;
    pushLine('COLOR', colorPages);
    pushLine('BW', bwPages);
  } else {
    const colorSheetCount = colorSheets.length;
    const bwSheetCount = bwSheets.length;
    if (colorSheetBilling === 'SHEET_AS_COLOR') {
      pushLine('COLOR', colorSheetCount);
      pushLine('BW', bwSheetCount);
    } else {
      // PER_PAGE_ACTUAL: count each page at its own mode
      const bwPages = selectedPages.filter(p => spec.pageModes.find(m => m.page === p)?.mode !== 'color').length;
      pushLine('COLOR', selectedPages.length - bwPages);
      pushLine('BW', bwPages);
    }
  }

  const subtotal = lines.every(l => l.linePaise !== null)
    ? lines.reduce((sum, l) => sum + (l.linePaise ?? 0), 0)
    : null;

  return {
    selectedPages,
    sheets,
    tasks,
    warnings,
    collationGuide: { needed: collationNeeded, copies, steps: collationSteps },
    pricing: {
      lines,
      subtotalPaise: subtotal,
      ruleMissing: lines.some(l => l.ruleMissing),
    },
  };
}

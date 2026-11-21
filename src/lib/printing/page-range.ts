/**
 * Page-range parser (Phase 3). Pure. Accepts the customer's text from the
 * page-selection field, e.g. "1-5, 8, 10-12", plus the shortcuts the UI
 * offers (All / Odd / Even). Errors name the exact invalid page.
 */

export class RangeParseError extends Error {
  constructor(message: string, public readonly invalidPage?: number) {
    super(message);
    this.name = 'RangeParseError';
  }
}

/** Parse "1-5, 8, 10-12" into a sorted, de-duplicated page list. */
export function parsePageRange(text: string, pageCount: number): number[] {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned === '') throw new RangeParseError('Enter a page range like 1-5, 8, 10-12, or choose All pages.');
  if (!/^[0-9,\-]+$/.test(cleaned)) {
    throw new RangeParseError('The range may only contain numbers, commas and hyphens.');
  }
  const parts = cleaned.split(',').filter(p => p !== '');
  const out = new Set<number>();
  for (const part of parts) {
    if (part === '') continue;
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) {
      throw new RangeParseError(`"${part}" is not a valid page or range.`);
    }
    const from = parseInt(m[1]!, 10);
    const to = m[2] !== undefined ? parseInt(m[2]!, 10) : from;
    if (from === 0 || to === 0) {
      throw new RangeParseError('Pages start at 1 — page 0 does not exist.', 0);
    }
    if (to < from) {
      throw new RangeParseError(`Range ${from}-${to} is reversed. Write it as ${to}-${from}.`, from);
    }
    if (to > pageCount) {
      throw new RangeParseError(
        `Page ${to} is out of range. This file has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
        to,
      );
    }
    for (let p = from; p <= to; p++) out.add(p);
  }
  return [...out].sort((a, b) => a - b);
}

export function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, i) => i + 1);
}

export function oddPages(pageCount: number): number[] {
  return allPages(pageCount).filter(p => p % 2 === 1);
}

export function evenPages(pageCount: number): number[] {
  return allPages(pageCount).filter(p => p % 2 === 0);
}

/** Human short form: consecutive runs collapse to "1-5, 8, 10-12". */
export function formatPageRange(pages: number[]): string {
  if (pages.length === 0) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  let start = sorted[0]!;
  let prev = start;
  for (const p of sorted.slice(1)) {
    if (p === prev + 1) { prev = p; continue; }
    runs.push([start, prev]);
    start = p; prev = p;
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

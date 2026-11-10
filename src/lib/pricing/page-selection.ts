/**
 * Server-authoritative page selection helpers.
 *
 * P1-15 (revenue bug): the PATCH `/api/v1/orders/:id/files/:fileId` endpoint
 * used to charge customers for the file's *entire* page count even when they
 * selected only a subset of pages via `pageRange` (e.g. a 3-of-200 selection
 * was billed for 200). This module parses the human-readable `pageRange`
 * string the customer sends into a deterministic list of 1-indexed page
 * numbers, validated against the document's true `pageCount`.
 *
 * Supported formats (per the API contract / PdfPreview UX):
 *   - `"3"`              → page 3
 *   - `"1,3,5"`          → pages 1, 3, 5
 *   - `"1-5"`            → pages 1, 2, 3, 4, 5
 *   - `"2-4,8,10-12"`    → pages 2, 3, 4, 8, 10, 11, 12
 *   - `null` / `""`      → ALL pages (caller falls back to `file.pageCount`)
 *
 * Validation rules (return `null` so the route can produce a clear 400):
 *   - Page numbers must be integers in `[1, maxPages]`.
 *   - Ranges must be ascending (`from <= to`); reversed ranges like `"5-3"`
 *     are rejected.
 *   - Whitespace is tolerated (`"1, 3, 5"` is accepted) so the UX doesn't
 *     have to be defensive about user input.
 *   - Malformed tokens (`"1-2-3"`, `"-5"`, `"abc"`) are rejected.
 *
 * Returns the *de-duplicated, sorted* page list. Overlapping ranges such as
 * `"1-5,3-7"` collapse to `[1,2,3,4,5,6,7]` (7 pages, not 10) — the customer
 * doesn't pay twice for a page they only print once.
 *
 * @module page-selection
 */

/**
 * Parse a human-readable page-range expression into a sorted, de-duplicated
 * list of 1-indexed page numbers, validated against `maxPages`.
 *
 * @param range  The raw string from the PATCH body (e.g. `"1-5,8,10-12"`).
 *               Empty string / `null`-ish handled by the caller — this
 *               function only runs when the caller has a non-empty range.
 * @param maxPages  The document's `file.pageCount` (the upper bound).
 * @returns Sorted unique page numbers (1-indexed), or `null` if the range
 *          is malformed or references pages outside `[1, maxPages]`.
 */
export function parsePageRange(range: string, maxPages: number): number[] | null {
  if (typeof range !== 'string' || range.trim() === '') return null;
  if (!Number.isInteger(maxPages) || maxPages <= 0) return null;

  const pages = new Set<number>();
  // Split on commas (allow surrounding whitespace per token).
  const tokens = range.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  for (const token of tokens) {
    // Single integer? e.g. "3"
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (!Number.isInteger(n) || n < 1 || n > maxPages) return null;
      pages.add(n);
      continue;
    }

    // Range? e.g. "1-5". Reject any token that doesn't look exactly like
    // `<digits>-<digits>` so malformed inputs like "1-2-3" or "-5" fail.
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
      if (from < 1 || to < 1 || from > maxPages || to > maxPages) return null;
      // Reversed range (e.g. "5-3") is a user error, not an implicit reverse.
      if (from > to) return null;
      for (let p = from; p <= to; p++) pages.add(p);
      continue;
    }

    // Anything else (negatives, decimals, letters, "1-2-3", "1-", etc.) → reject.
    return null;
  }

  if (pages.size === 0) return null;
  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Resolve the billable page count for a file given the (possibly null) page
 * range + the file's true page count. This is the single source of truth the
 * PATCH endpoint should use to compute pricing input.
 *
 * - `pageRange` null / undefined / empty → bill for ALL pages (backward
 *   compatible with orders created before page-selection existed).
 * - `pageRange` provided → parse + validate against `filePageCount`. Returns
 *   `{ billablePages, selectedPages }` on success or `{ error }` on failure.
 *
 * The caller is expected to surface the error as a `ValidationError` (HTTP
 * 400) so the customer can correct their selection.
 */
export function resolveBillablePages(
  pageRange: string | null | undefined,
  filePageCount: number | null,
): { billablePages: number; selectedPages: number[] | null } | { error: string } {
  // No pageCount on file → either it's a non-paginated file (image) or the
  // page counter couldn't parse it. Default to 1 page (matches the historical
  // `file.pageCount ?? 1` behaviour) and don't validate the range.
  const pageCount = filePageCount && filePageCount > 0 ? filePageCount : null;

  if (pageRange === undefined || pageRange === null || pageRange.trim() === '') {
    return { billablePages: pageCount ?? 1, selectedPages: null };
  }

  if (!pageCount) {
    // A range was supplied but we don't know the document's length — we
    // can't validate it, so reject rather than silently bill for the wrong
    // number of pages.
    return {
      error:
        `Cannot apply a page range to a document with an unknown page count. ` +
        `Either remove the page range or wait for the shopkeeper to confirm the page count.`,
    };
  }

  const selected = parsePageRange(pageRange, pageCount);
  if (selected === null) {
    return {
      error:
        `Invalid page range "${pageRange}" for a ${pageCount}-page document. ` +
        `Use formats like "1-5", "1,3,5", or "2-4,8,10-12". Pages must be between 1 and ${pageCount}.`,
    };
  }
  return { billablePages: selected.length, selectedPages: selected };
}

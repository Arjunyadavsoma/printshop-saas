# P1-15 + Workstream 2 + Workstream 3 — Consumer Integrity

**Branch**: `phase-6-1-consumer-integrity` (based on `e48d81f` — Phase 6)
**Agent**: senior payments-backend engineer
**Task ID**: P1-15-consumer-integrity

## Summary

Fixed the P1-15 revenue bug in the PATCH `/files/[fileId]` pricing path
(the endpoint charged for `file.pageCount` instead of the customer's
selected `pageRange`). Hardened checkout amount integrity. Added 31
regression tests (parsePageRange unit + PATCH→checkout integration).
Audited the upload flow for cancellation / retry / dedup / replacement
hygiene. Improved the PdfPreview component with zoom, fit-to-width,
clear-selection, selected-page count, keyboard a11y, and loading/error
states.

## Workstream 1 — Server-authoritative page selection + pricing

### Fix 1: PATCH endpoint (`src/app/api/v1/orders/[id]/files/[fileId]/route.ts`)
- Imports `resolveBillablePages` from the new `@/lib/pricing/page-selection`.
- After parsing the PATCH body, computes the **effective pageRange** (body
  overrides persisted value) and calls `resolveBillablePages(effectivePageRange, file.pageCount)`.
- On error → `ValidationError` (HTTP 400) with a message naming the
  document's page count + the valid range format.
- On success → `billablePages` is the input to `priceFile`. The
  `pageRange` is still persisted via `repos.files.update(file.id, { ...body, pricePaise: result.totalPaise })`.

### New module: `src/lib/pricing/page-selection.ts`
- `parsePageRange(range, maxPages)` → sorted, de-duplicated 1-indexed page
  numbers, or `null` on malformed/out-of-range input.
- `resolveBillablePages(pageRange, filePageCount)` → `{ billablePages,
  selectedPages }` or `{ error }`. Null/empty range falls back to
  `filePageCount ?? 1` (backward compatible).

### Fix 2: Checkout integrity (`src/app/api/v1/orders/[id]/checkout/route.ts`)
- Verified the route sources `amountPaise` exclusively from
  `order.totalAmountPaise` (the server-persisted total). NO client-supplied
  amount is read — the request body isn't even JSON-parsed.
- Added clarifying comments at the docstring + at the
  `amountPaise: order.totalAmountPaise` line documenting the P1-15 invariant.

### Fix 3: Tests
- `src/lib/pricing/page-selection.test.ts` — 21 unit tests covering all 14
  required cases (all-pages fallback, single page, individuals, single range,
  mixed ranges, copies×pages, colour+duplex, every invalid input, backward
  compatibility) + extras (overlapping range dedup, whitespace tolerance,
  unknown-pageCount + supplied range rejection).
- `src/lib/pricing/pricing-with-selection.test.ts` — 10 integration tests
  that exercise the REAL PATCH + checkout route handlers against an
  in-memory container + mocked `@/lib/db`. Proves:
  1. pageRange="1-5" on 200-page file → 1000 paise (5 × 200), NOT 38000.
  2. pageRange=null → 38000 paise (200 × 200, with 5% bulk discount).
  3. copies=3 + pageRange="1-5" → 3000 paise (15 × 200).
  4. price is recomputed when pageRange changes (5 ↔ 200 ↔ 5).
  5. Out-of-range pageRange → 400 VALIDATION_ERROR, file price unchanged.
  6. Reversed range "5-3" → 400.
  7. Checkout amount matches server total (1000 paise).
  8. **Price tampering**: client sends `{ totalAmountPaise: 1 }` in
     checkout body → checkout still returns the server-side 1000 paise.
  9. Checkout reflects the bulk-discounted 200-page total (38000).
  10. Checkout reflects copies × selected pages (3000).

## Workstream 2 — Upload reliability audit + minimal fixes

File: `src/app/orders/[id]/page.tsx`

**Audit findings:**
1. **Upload cancellation** — `xhr.onabort` existed but was unreachable
   (no exposed cancel button). The error message was "Upload aborted."
   not "Upload cancelled".
2. **Retry** — no retry function existed; failed uploads required
   re-selecting the file.
3. **Duplicate detection** — none in the upload flow. Distinct files with
   the same name but different content are NOT rejected (no false
   positives — verified, no fix needed).
4. **File replacement** — `removeFile` filtered the file out (rawFile was
   dropped implicitly), but no abort of an in-flight XHR was attempted.

**Minimal fixes applied (no rewrite):**
- Added `uploadXhrsRef` (Map<placeholderId, XMLHttpRequest>) so the XHR
  for each in-flight upload is tracked.
- Hoisted the presign→PUT→confirm→auto-PATCH flow into `uploadOne()`
  (declared BEFORE `handleFiles` to avoid TDZ / exhaustive-deps warnings).
  `uploadOne` ALWAYS mints a FRESH presigned URL (retry never reuses an
  expired one).
- Added `cancelUpload(fileId)` — aborts the XHR, sets status to
  `'failed'` with `uploadError: 'Upload cancelled'`. Suppresses the
  global `uploadError` banner for cancellations (intentional user action).
- Added `retryUpload(fileId)` — re-invokes `uploadOne` with the failed
  entry's preserved `rawFile` (the raw File object is kept across failures
  for this purpose).
- Updated `removeFile` to also abort any in-flight XHR + clear the ref
  (so a removed file can't keep uploading in the background or hold a
  stale Blob in memory).
- Updated `FileCard` to expose:
  - Cancel button (XCircle icon) when `status === 'uploading'`
  - Retry button (RefreshCw icon) when `status === 'failed'` + `rawFile`
    present
- Wired `onCancelUpload` + `onRetryUpload` through `UploadStep` → `FileCard`.

## Workstream 3 — PDF preview improvements

File: `src/components/portal/pdf-preview.tsx`

**Added:**
1. **Zoom in/out** — buttons step the thumbnail scale by 0.25, clamped to
   `[0.25, 2.0]`. Scale shown as a percentage badge. Applied as a CSS
   `transform: scale()` (no PDF.js re-render needed — cheap).
2. **Fit-to-width** — resets the zoom to 1.0 (the default scale).
3. **Clear selected pages** — new "Clear" button with Eraser icon
   (calls `deselectAll`; disabled when no pages selected). The old
   "Deselect All" button is replaced by this clearer label.
4. **Selected-page count** — "X / Y pages selected" badge + "X of Y pages
   selected (Z% of document)" summary, with `aria-live="polite"` so screen
   readers announce selection changes.
5. **Loading/error states** — spinner with `role="status"` + sr-only text
   while loading; `role="alert"` for errors. Error message is more useful
   ("PDF worker failed to load" instead of a generic worker exception).

**Keyboard accessibility (added, per spec):**
- Each page thumbnail div now has:
  - `role="checkbox"`
  - `tabIndex={0}`
  - `aria-checked={isSelected}`
  - `aria-label={`Page N (selected|not selected)`}`
  - `onKeyDown` handler that toggles on Space or Enter (WAI-ARIA checkbox
    pattern) — with `e.preventDefault()` so the page doesn't scroll.
- Pagination controls have `aria-label`s + `aria-current`.
- Focus ring (`focus-visible:ring-2 focus-visible:ring-brand`) on each
  page so keyboard users can see which page is focused.

**Other improvements:**
- Image preview now uses a stable object URL (the old code called
  `URL.createObjectURL(file)` on every render, leaking Blob URLs).
- Zoom resets to 1.0 on every new file load (no per-file zoom bleed).
- Page thumbnails are `draggable={false}` (so users don't accidentally
  drag a data-URL image).

## Validation Results

| Check | Command | Result |
|-------|---------|--------|
| Branch | `git branch --show-current` | `phase-6-1-consumer-integrity` ✓ |
| TypeScript | `bunx tsc --noEmit` | exit 0 ✓ |
| ESLint | `bunx eslint .` | exit 0 ✓ |
| Vitest | `bunx vitest run --reporter=dot` | 39 files / **458 passed, 1 skipped** (459 total) ✓ |
| Pricing tests | `bunx vitest run src/lib/pricing/` | 2 files / **31 passed** ✓ |
| Prisma validate | `DATABASE_URL=postgresql://… bunx prisma validate` | "The schema at prisma/schema.prisma is valid 🚀" exit 0 ✓ |
| Next build | `timeout 300 bunx next build` | ✓ Compiled successfully in 26.1s · ✓ 63/63 static pages · exit 0 ✓ |
| Route conflicts | `bash scripts/check-route-conflicts.sh` | ✅ No dynamic route conflicts found · exit 0 ✓ |

### Notes on the prisma validate run
The bare `bunx prisma validate` failed with P1012 because the sandbox's
`DATABASE_URL=file:…/custom.db` (SQLite) doesn't match the schema's
`provider = "postgresql"`. This is a **pre-existing sandbox env quirk**,
NOT a regression from this task — the schema structure itself validates
cleanly when a postgresql:// URL is supplied (see command above).

## Files touched

**New:**
- `src/lib/pricing/page-selection.ts`
- `src/lib/pricing/page-selection.test.ts`
- `src/lib/pricing/pricing-with-selection.test.ts`

**Modified:**
- `src/app/api/v1/orders/[id]/files/[fileId]/route.ts` — P1-15 fix
- `src/app/api/v1/orders/[id]/checkout/route.ts` — amount-integrity comment
- `src/app/orders/[id]/page.tsx` — Workstream-2 upload reliability fixes
- `src/components/portal/pdf-preview.tsx` — Workstream-3 preview improvements

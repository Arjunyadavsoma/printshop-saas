# P1-16 — Production Document Pricing Frontend Update

**Task ID**: P1-16
**Agent name**: frontend-developer
**Branch**: `fix/production-document-pricing`
**Date**: 2026-11-14

## Summary

Updated the consumer order page (`src/app/orders/[id]/page.tsx`) and the shop
order page (`src/app/shop/orders/[id]/page.tsx`) to match the new backend API
shapes introduced by the `page_count_source` migration. Also updated the
customer-facing status endpoint to surface the new file fields so the
consumer page can hydrate placeholder state correctly on refresh.

## Backend context (already merged)

The confirm endpoint now returns:
- `pageCount: number | null`
- `pageCountSource: 'auto_extracted' | 'placeholder'`
- `pageCountEstimated: boolean`
- `status: 'pending' | 'needs_review'`
- `pricePaise: number` (0 for placeholder)
- `processingError: string | null`
- `orderTotalPaise`, `needsReview`

The PATCH endpoint's file object now includes `pageCountSource`, `status`,
`processingError`. When the customer supplies `pageCount`, the server marks
the source as `customer_declared` and prices the file.

The shopkeeper page-count endpoint (`POST /api/v1/shops/me/orders/:id/files/:fileId/page-count`)
marks the source as `shopkeeper_confirmed` (highest trust) and prices the file.

## Files modified

### 1. `src/app/orders/[id]/page.tsx` (consumer order page)

**Type updates**
- `StatusFile`: added `pageCountSource?: string`, `processingError?: string | null`.
  (`pageCount?` and `pricePaise?` were already optional.)
- `ConfirmFileResponse`: `pageCount` is now `number | null`; added
  `pageCountSource`, `processingError`; status narrowed to
  `'pending' | 'needs_review'`. Kept `pageCountEstimated` for backward compat.
- `PatchFileResponse.file`: `pageCount` is now `number | null`; added
  `pageCountSource`, `status`, `processingError`.
- `LocalFile`: replaced `pageCountEstimated: boolean` with
  `pageCountSource: string` and added `processingError: string | null`.

**`uploadOne`** — reads `c.pageCount ?? 0`, `c.pageCountSource`,
`c.processingError`, `c.pricePaise` directly from the confirm response. Sets
`status: c.status === 'needs_review' ? 'needs_review' : 'uploaded'` so
placeholder files keep their needs_review status.

**`handleFiles` placeholder** — initialises `pageCountSource: 'placeholder'`
and `processingError: null` on the optimistic placeholder row.

**`loadOrder` (syncExistingFiles)** — for each server file:
- `pageCount: f.pageCount ?? existing.pageCount ?? 0`
- `pageCountSource: f.pageCountSource ?? existing.pageCountSource ?? 'placeholder'`
- `processingError: f.processingError ?? existing.processingError ?? null`
- `pricePaise: f.pricePaise ?? existing.pricePaise ?? 0`
- `status: isReview ? 'needs_review' : 'uploaded'` (where
  `isReview = f.status === 'needs_review' || f.pageCountSource === 'placeholder'`).

The `?? existing.* ?? 'placeholder'` pattern preserves the in-flight values
the customer already saw (e.g. after a PATCH that hasn't been flushed) and
falls back to safe defaults only when neither the server nor local state has
the field. This is defensive against the status endpoint omitting the new
fields on legacy deployments.

**`updateFile`** — kept the `'uploading'`/`'failed'` early return but
explicitly allows PATCHing `needs_review` files (no skip check). The PATCH
response handler now updates `pageCountSource`, `processingError`, and
`status` (mapping server `'needs_review'` to LocalFile `'needs_review'`).

**`FileCard`** — `isReview` now also covers `pageCountSource === 'placeholder'`.
- For review files: shows a brand-coloured banner ("Page count required —
  enter the number of pages in the Configure step to get a price.") with the
  processing error appended when present.
- The file-size line shows size always, and " · N pages" only for non-review
  files (never "0 pages").
- All settings inputs stay disabled when `isReview`.
- The price line shows "Pending" instead of `₹0.00` for review files.
- Card border stays highlighted (`border-brand-border`) for review files.

**`ConfigureStep`** — for each file:
- Computes `isPlaceholder = f.pageCountSource === 'placeholder'`.
- Badge: `Page count required` (outline + brand styling) for placeholder,
  `${pageCount} pages` otherwise.
- PDF preview hidden for placeholder files (can't render a .doc).
- A prominent placeholder hint: "This file's page count couldn't be
  auto-detected. Enter the actual page count below to price it."
- Page count input is always first in the grid, visually highlighted for
  placeholder files (`bg-brand-soft/50 ring-1 ring-brand-border`), and has
  `aria-required` for screen readers. Shows the auto-detected count
  pre-filled for `auto_extracted` files.
- All other settings (`copies`, `color`, `paper`, `duplex`) are disabled
  when `isPlaceholder` — they can't be priced without a page count.
- Price line: shows `—` for placeholder files, the formatted price otherwise.
- The "Pending page count" label replaces the "N pages × M copies" summary
  for placeholder files.

**`CheckoutStep`** — splits files into `priced` (status `'uploaded'` —
server `'pending'`/`'queued'` map to LocalFile `'uploaded'`) and `reviewFiles`
(status `'needs_review'` OR `pageCountSource === 'placeholder'`).
- Shows a prominent banner when `reviewFiles.length > 0`: "N file(s) need a
  page count before checkout. Enter the page count in the Configure step."
- Priced files render as normal line items.
- Review files render as distinct rows with a "Page count required" badge
  and `—` for both settings and price.
- The total row sums only priced files and is labelled "Server-confirmed
  total (priced files only)" when there are review files.
- "Create payment" button is disabled when `hasReview` is true (in addition
  to `busy` and `priced.length === 0`).

### 2. `src/app/shop/orders/[id]/page.tsx` (shop order page)

**Type updates**
- `PrintFile`: added `pageCountSource?: string` and `processingError?: string | null`.
  The shop detail endpoint already returns the full PrintFile shape from
  `repos.files.findByOrder()`; this just makes the type match.

**New state** — `pageCountDrafts: Record<string, string>`,
`settingPageCount: string | null`, `pageCountError: string | null`.

**New handler `setPageCount`** — POSTs to
`/api/v1/shops/me/orders/${orderId}/files/${file.id}/page-count` with
`{ pageCount: N }`. Validates 1-10000 integer. On success: toast + clears the
draft + `load(true)` to refresh the order. On error: toast + sets
`pageCountError`.

**New card: "Files awaiting review"** — shown when `reviewFiles.length > 0`.
For each review file:
- Filename, format (`formatMime`), size, and processing error.
- Inline "Page count" Input (1-10000) + "Set & price" Button (min-h-[44px]).
- The Input is controlled by `pageCountDrafts[f.id]`.
- The Button is disabled while the request is in flight or when the draft
  is empty.

`reviewFiles` is computed once after the `if (!order) return null;` check.

**Files table updates**:
- Pages cell: shows a "Review" badge (`border-brand-border bg-brand-soft
  text-brand`) for review files; the page count otherwise.
- Price cell: shows "Pending" for review files; the formatted price otherwise.
- `PrintLatchButton` is disabled for review files (can't print a placeholder).

**Detailed print instructions panel**:
- Review files get a `border-brand-border` highlight.
- The summary line shows "Page count required" instead of "N pages" for
  review files.
- Shows the `processingError` (if any) below the grid for review files.

The `formatMime` function (DOC/DOCX/PPT/PPTX/XLS/XLSX/RTF/TXT/CSV) is kept
unchanged — it was already extended.

### 3. `src/app/api/v1/orders/[id]/status/route.ts` (customer status endpoint)

Added `pageCount`, `pageCountSource`, `processingError`, and `pricePaise`
to the per-file map in the response. Without this, the consumer page's
`syncExistingFiles` would default all files to `'placeholder'` on a fresh
load (e.g. when the customer opens a shared order link without having
uploaded first), which would be a regression. The file repository already
returns these fields via `PrintFile`; this just exposes them to the client.

This change does not touch payment-related code, routing, or layout — it
only adds fields to the existing files array.

## Verification

- `bun run lint` — passes (exit 0).
- `bunx tsc --noEmit` — passes (exit 0, including test files).
- No emojis added.
- Touch targets: all buttons use `min-h-[44px]` (existing pattern preserved).
- Uses existing shadcn/ui components (Card, Button, Input, Label, Badge,
  Separator) — no new dependencies.
- Uses `formatINRFromPaise` from `@platform/utils` for all prices.
- Uses `toast` from `sonner` for shopkeeper notifications.
- Uses `useApiClient` for all API calls; the `api.request<T>(method, url,
  { body })` signature is respected.

## Notes

- The dev server script failed to start because `DATABASE_URL` is set to a
  SQLite file path while `prisma/schema.prisma` declares `provider =
  "postgresql"`. This is a pre-existing environment misconfiguration
  unrelated to this task; the system will restart the dev server once the
  env is fixed. Lint + typecheck both pass cleanly.
- The `pageCountEstimated: boolean` field is kept on `ConfirmFileResponse`
  for backward compat (the server still returns it as
  `pageCountSource === 'placeholder'`); the frontend no longer reads it.
- LocalFile's status union deliberately excludes server `'pending'`/
`'queued'` — they map to LocalFile `'uploaded'` in `loadOrder` and
  `uploadOne`. The CheckoutStep's `priced` filter uses `'uploaded'` only,
  which covers both server states.

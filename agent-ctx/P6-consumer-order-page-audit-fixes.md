# P6 — Consumer order page audit fixes (phase-6-consumer-experience)

**Task ID:** P6-consumer-order-page-audit-fixes
**Agent:** senior-frontend-engineer
**Branch:** phase-6-consumer-experience
**Date:** 2026-11-10

## Files modified

1. `src/app/orders/[id]/page.tsx` — consumer order page (P0/P1 audit fixes)
2. `src/components/portal/pdf-preview.tsx` — PDF preview component (design tokens + keyboard accessibility)

## Changes summary

### Fix 1 — `OrderStatusResponse` interface (P0-01 follow-up)
- Removed `customerToken` from the `OrderStatusResponse` interface (server no longer returns it).
- `TrackStep` no longer reads `props.order.customerToken`. Now displays `props.order.tokenNumber ?? (props.orderToken ?? '—')` where `orderToken` is the per-order access token passed down from the parent (read from `?t=` URL query or `sessionStorage` on first load).
- Updated the inline comment about `customerToken` being a bearer secret to be more readable.

### Fix 2 — Client-side file validation (P0-02)
- Added import: `ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES` from `@platform/core/domain` (defined in `packages/core/src/domain/file.ts`, re-exported from the domain barrel).
- Added import: `toast` from `sonner` (the project's Toaster is mounted in `src/app/layout.tsx`).
- New top-level helpers: `ALLOWED_FILE_EXTENSIONS` set (extension mirror of the server MIME allowlist), `fileExt(filename)` parser, and `validateFile(file, existingFiles)` returning `{ valid, error? }`.
- `validateFile` checks (in order): empty file → size cap (25MB mirror) → type allowlist (MIME preferred, extension fallback for browsers that report empty MIME) → duplicate detection via `name + size + lastModified`.
- `handleFiles` now calls `validateFile` BEFORE minting the upload URL. Rejected files are surfaced via `toast.error(...)` and skipped (`continue`) — never silently discarded.
- Added a `filesRef` mirror of `files` state (synced on each render) so `handleFiles`/`retryUpload` can read the latest snapshot inside async callbacks without depending on `files` and being recreated each render.

### Fix 3 — Upload cancellation (P0-03)
- Added `xhr?: XMLHttpRequest | null` field to the `LocalFile` interface.
- Extracted the upload logic from `handleFiles` into a new `uploadFile(file, placeholderId)` callback. The XHR created inside the Promise is stashed on the LocalFile via `setFiles(...)` so the Cancel button can reach it.
- New `cancelUpload(fileId)` callback: calls `xhr.abort()`. The XHR's `onabort` rejects with `"Upload cancelled"`, which `uploadFile`'s catch block converts to a `failed` status with that error message. The catch block intentionally suppresses the toast for user-initiated cancels (the UI already confirms the action).
- `FileCard` renders a Cancel button (`XCircle` icon, already imported from lucide-react) when `status === 'uploading'`. Button has `aria-label="Cancel upload"` and `focus-visible:ring-2 focus-visible:ring-ring` for keyboard users.

### Fix 4 — Per-file retry (P1-05)
- `FileCard` renders a Retry button (`RefreshCw` icon, already imported) when `status === 'failed'`.
- New `retryUpload(fileId)` callback: reads the LocalFile from `filesRef`, requires `rawFile` to still be present (it's stashed when the user picks the file but lost on page refresh), resets the row to `uploading` state, and re-invokes `uploadFile`. If `rawFile` is gone, shows a clear toast telling the user to re-add the file.
- The shared `uploadFile` function is the single source of truth for the upload-url → PUT → confirm → auto-PATCH flow — no duplicated logic between `handleFiles` and `retryUpload`.

### Fix 5 — Keyboard-accessible preview thumbnails (P0-04)
- `pdf-preview.tsx`: the page-selection thumbnails were `<div onClick={...}>` — not focusable, no role, no keyboard handler.
- Added `role="checkbox"`, `tabIndex={0}`, `aria-checked={isSelected}`, an `aria-label` describing the page + selection state, and an `onKeyDown` handler that toggles on Enter or Space (with `e.preventDefault()` to stop page scroll on Space).
- Added `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` for visible keyboard focus. Also `focus-visible:opacity-100` on unselected tiles so they don't stay dim when focused.
- The inner selection-checkmark circle is marked `aria-hidden="true"` (it's decorative; the parent checkbox role already conveys state).

### Fix 6 — Page range pricing fix (P1-11)
- `displayPriceForFile(f, shop)` previously used `f.pageCount` for the `pages` input. Now uses `f.selectedPages?.length` when a subset is selected, falling back to `f.pageCount || 1` when `selectedPages` is null/empty. This keeps the client-side display in sync with the page-selection UI.
- **Documented as a known limitation** in a multi-line comment above the function: the server-side PATCH `/api/v1/orders/:id/files/:fileId` endpoint prices on `file.pageCount` (the whole document) and does NOT yet parse `pageRange`/`selectedPages` for pricing — `packages/core/src/pricing/pricing-engine.ts` takes `pages` as a flat count, not a range. So the client estimate may differ from the server-confirmed total at checkout when a page subset is selected. The server remains authoritative; this is display-only.

### Fix 7 — Colour label consistency (P1-13)
- Standardised on the British spelling "Colour" everywhere in the order page.
- The only mismatched label was in `FileCard`'s color ToggleGroup: `<ToggleGroupItem value="color">Color</ToggleGroupItem>` → `Colour`. (`ConfigureStep` and `CheckoutStep` already used "Colour".)
- The `B&W` item was also rewritten as `B&amp;W` for valid JSX (was previously bare `&` which worked but is not strictly valid JSX text).

### Fix 8 — Design token compliance (P0-05)
- All hard-coded colors were in `pdf-preview.tsx` (the order page was already token-compliant).
- Replacements:
  - `bg-green-600 text-white` → `bg-success text-success-foreground` (image-preview checkmark)
  - `border-green-500` → `border-success` (selected thumbnail border)
  - `border-green-500 bg-green-600 text-white` → `border-success bg-success text-success-foreground` (selected checkmark circle)
  - `group-hover:border-green-400` → `group-hover:border-success/60` (unselected hover)
  - `text-amber-500` → `text-warning` (PDF error icon)
  - `text-amber-700` → `text-warning` (excluded-pages count)
  - `text-red-500` → `text-destructive` (no-pages-selected warning)
- The `border-white bg-white/80 text-transparent` triple on the unselected checkmark circle was kept (it's intentionally white to look like an empty checkbox); only the `group-hover:border-green-400` portion was tokenised.
- The `text-white` on the page-number gradient overlay was kept (it's foreground on a black gradient, not a status colour).
- Tokens `--success`, `--success-foreground`, `--warning`, `--destructive` are defined in `src/app/globals.css` (light + dark) and exposed via `@theme inline` for Tailwind v4.

## Verification

- `bunx tsc --noEmit` → exit 0 (no type errors)
- `bunx eslint .` → exit 0 (no lint errors)
- `bunx vitest run --reporter=dot` → 29 test files / 325 tests passed, 1 pre-existing skip. No regressions.

## Notes for follow-up

- The server-side pricing engine (`packages/core/src/pricing/pricing-engine.ts` + `src/app/api/v1/orders/[id]/files/[fileId]/route.ts`) prices on `file.pageCount` and does not yet parse the `pageRange` string for per-page pricing. This is the P1-11 server-side half — out of scope for this frontend audit but documented in code as a known limitation.
- `MAX_UPLOAD_SIZE_BYTES` (25MB) and `ALLOWED_UPLOAD_MIME_TYPES` live in `packages/core/src/domain/file.ts`, not `enums.ts` as the audit text suggested. The audit text was slightly off; the implementation imports from `@platform/core/domain` which re-exports `file.ts`.

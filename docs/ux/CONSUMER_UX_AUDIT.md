# Consumer UX Audit — PrintShop SaaS

> ## Phase 6.1 Update (2024-12) — RESOLVED findings
>
> The following findings are now **RESOLVED** on branch
> `phase-6-1-consumer-integrity`:
>
> | ID | Sev | Area | Resolution |
> |---|---|---|---|
> | **P1-15** | P1 | Pricing | **RESOLVED** — `pageRange` now drives the price via `resolveBillablePages()` (`src/lib/pricing/page-selection.ts`). The PATCH `/files/[fileId]` route validates the range against `file.pageCount` and uses `billablePages` (not `file.pageCount`) as the `PricingInput.pages` value. The checkout route sources the amount **exclusively** from `order.totalAmountPaise` (server-persisted, never client-supplied). 31 new tests (21 unit + 10 integration) including a price-tampering rejection test. |
> | **P0-03** | P0 | Upload | **RESOLVED** — upload cancellation implemented via `uploadXhrsRef` (Map of in-flight XHRs). `cancelUpload()` aborts the XHR + marks the file `failed` with `'Upload cancelled'`. Cancel button on every uploading card. |
> | **P1-05** | P1 | Upload | **RESOLVED** — per-file retry implemented. `retryUpload()` re-invokes `uploadOne()` with the failed entry's preserved `rawFile`, minting a FRESH presigned URL (never reuses an expired one). Retry button on every failed card with a preserved `rawFile`. |
> | **P1-10** | P1 | Preview | **RESOLVED** — zoom in/out (0.25 → 2.0, step 0.25), fit-to-width (reset to 1.0), clear-selection (Eraser icon), selected-page count badge + summary with `aria-live="polite"`, loading + error states with `role="status"` / `role="alert"`. |
>
> Full verification: `docs/ux/PHASE_6_1_VERIFICATION.md`.
>
> ---

> A walk-through of every consumer-facing route, component, API endpoint,
> and data model in the repository, classified by severity.
>
> **Method:** every file listed below was read in full before its finding
> was written. Line numbers are exact. Where a behaviour is asserted, the
> assertion is grounded in a quoted code reference. Where a behaviour is
> *not* implemented, that is stated explicitly — no feature is claimed to
> work unless the code proves it.
>
> **Severity:**
> - **P0** — critical: blocks a primary user task, a security issue, or
>   a WCAG 2.2 Level A/AA failure.
> - **P1** — important: degrades the experience but has a workaround.
> - **P2** — nice-to-have: polish, consistency, minor inefficiency.

---

## 1. Route inventory

| Route | File | User | Purpose |
|---|---|---|---|
| `/` | `src/app/page.tsx` (448 lines) | Customer | Shop discovery + marketing hero |
| `/shops/[slug]` | `src/app/shops/[slug]/page.tsx` (399 lines) | Customer | Shop detail + pricing reference + start order |
| `/orders/[id]` | `src/app/orders/[id]/page.tsx` (1569 lines) | Customer | 5-step wizard: upload → configure → checkout → pay → track |
| `/shop/login`, `/shop/register`, `/shop/*` | `src/app/shop/*` | Shopkeeper | Out of scope |
| `/admin/*` | `src/app/admin/*` | Admin | Out of scope |

No 404 / "shop not found" dedicated page; the shop-detail page renders
an inline error card (line 177–193) and the order page renders an inline
fatal-error card (line 652–664). `src/app/not-found.tsx` and
`src/app/error.tsx` exist as Next.js fallbacks.

---

## 2. Home and service discovery — `src/app/page.tsx`

**Strengths.**
- Hero, "How it works" steps, trust indicators, and shop discovery
  sections are all present with semantic landmarks (`<header>`,
  `<section>`, `<main>`, `<footer>`).
- Loading, error, and empty states for the shop list are all implemented
  (lines 283–330).
- Shop cards are keyboard-activatable: `role="button"`, `tabIndex={0}`,
  `onKeyDown` Enter/Space handler, `aria-label` (lines 387–396).
- Friendly error sentinel: raw API error messages are logged to console
  in dev only and a friendly `load-failed` sentinel is surfaced to the
  UI (lines 134–141). Good — prevents Prisma stack traces from leaking.
- Footer is sticky via `mt-auto` on `<footer>` inside a `min-h-screen
  flex flex-col` wrapper (lines 164, 345).

**P1-01. Search is client-side only.** `filtered` (lines 152–158)
filters a list of ≤50 shops already loaded. The endpoint
`/api/v1/shops?limit=50` (line 131) caps the result set; if there are
>50 shops, the customer will never see shop #51+. The "Clear" button
(line 270–278) clears the query but does not re-fetch. No pagination
UI. **Fix:** paginate the API + add a "Load more" control.

**P2-01. The `TRUST_INDICATORS[3]` entry has both a `body` and `detail`
field** (lines 94–98) but only `detail` is rendered (line 203). Dead
field.

**P2-02. Hero "I run a print shop" button links to `/shop/login`**
(line 186) rather than `/shop/register`. A shopkeeper who has never
signed up lands on a login form with no clear path to register from
that page (the register link is in the footer only).

---

## 3. Shop selection — `src/app/shops/[slug]/page.tsx`

**Strengths.**
- Pricing reference table renders all 8 per-page rates (B&W/Colour ×
  A4/A3/Letter/Legal) plus duplex, bulk threshold, bulk discount, and
  minimum order value (lines 49–58, 60–62, 259–287).
- Sticky start-order card on `lg:` (line 314: `lg:sticky lg:top-6
  lg:h-fit`) — good for desktop.
- `LocalBusiness` JSON-LD injected for SEO (lines 106–126) —
  injects on shop load, cleans up on unmount.
- Skeleton states (lines 363–397) match the real layout shape.

**P1-02. Order creation requires the customer to leave the page with a
`?t=` token in the URL.** `startOrder` (lines 128–154) POSTs to
`/api/v1/shops/{slug}/orders` and on success pushes to
`/orders/{orderId}?shop={slug}&t={customerToken}`. The order page
strips `?t=` from the URL on first load (orders/[id]/page.tsx
lines 192–207) and stores it in `sessionStorage`. This is correct,
but the customer's browser history entry for the *shop page* still
contains the URL with `?t=` (the redirect happens *after* navigation,
not server-side). **Risk:** referrer leak if the order page makes any
cross-origin request before stripping the URL. **Mitigation already
applied:** the order page strips `?t=` in a `useEffect` on first paint
(line 198). Acceptable; document the ordering.

**P1-03. No loading state on the "Start order" button during redirect.**
The button shows `Loader2` + "Starting…" while the POST is in flight
(lines 336–339) but the redirect itself is synchronous; if the order
page is slow to hydrate, the customer sees the loader vanish and a
blank screen. Consider a `<Suspense>` boundary or an inline "Taking
you to your order…" message.

**P2-03. Address shown is actually `timezone`.** Line 213 renders
`{shop.timezone}` under a `<MapPin>` icon. The `ShopInfo` interface
declares `address?: string` (line 31) but it is not used. A customer
expecting an address sees "Asia/Kolkata".

---

## 4. Consumer authentication — guest flow + `customerToken`

**Mechanism.** Customers never log in. Order creation returns a
`customerToken` (a 6-char uppercase alnum, generated in
`src/app/api/v1/shops/[slug]/orders/route.ts` line 61 via
`generateOrderToken()`) plus a per-shop sequential `tokenNumber`. The
token is the customer's only credential for the order.

**Storage.** First load: read from `?t=` URL query, persist to
`sessionStorage` keyed `order-token:{orderId}`, strip from URL
(orders/[id]/page.tsx lines 185–208). Subsequent loads: read from
`sessionStorage`. Good — survives refresh, scoped per-tab, not
permanent, not in localStorage (so not leaked to other tabs).

**Transmission.** Every customer-facing `/api/v1/orders/:id/*` request
attaches `X-Order-Token: {token}` via the `orderAuthHeaders` memo
(lines 211–214). The header is merged last in the fetch (auth-context.tsx
line 167) so it cannot be overridden by caller-supplied headers.

**Verification.** `src/lib/api/with-order-access.ts` (98 lines)
constant-time-compares the supplied token against `order.customerToken`
(line 86, via `timingSafeEqual`). On mismatch: 403 with a generic
message (line 89) — does not reveal whether the order exists.

**P0-01. `customerToken` is returned by the status endpoint.**
`src/app/api/v1/orders/[id]/status/route.ts` line 33 returns
`customerToken: order.customerToken` in the response body. The customer
page already knows the token (it's how it authenticated), so this is
not a leak *to the customer* — but it means any MITM or logged response
contains the bearer secret in plaintext. The page only displays
`tokenNumber` (orders/[id]/page.tsx line 1278), so the leaked token is
unused by the UI. **Fix:** drop `customerToken` from the status
response; the page does not need it.

**P1-04. Token-clearing on order completion.** After `collected` /
`cancelled` / `refunded`, the `sessionStorage` entry
`order-token:{orderId}` is never cleared. A customer who completes an
order and starts a new one in the same tab has stale tokens
accumulating. **Fix:** clear on terminal status in `loadOrder`.

---

## 5. Document upload — `orders/[id]/page.tsx` upload step

**Pipeline (lines 353–462).**
1. Optimistic placeholder inserted with `status: 'uploading'` (line 359).
2. `POST /api/v1/orders/{id}/files/upload-url` mints a presigned PUT URL
   (line 383). Server validates MIME + size
   (`upload-url/route.ts` lines 36–43), mints a 300-second-expiry URL
   (line 51), returns `{fileId, storageKey, uploadUrl, expiresInSeconds}`.
3. XHR PUT to the presigned URL with `onprogress` (lines 394–408).
4. `POST /api/v1/orders/{id}/files` confirms the upload; server HEADs
   the object (`files/route.ts` line 56), validates size match (line 58),
   parses page count via `parsePageCount` (line 67), persists the file
   row (line 70), and sets `needs_review` if pageCount is null
   (lines 78–80).
5. If not needs_review, auto-PATCH with default settings (`copies: 1,
   colorMode: 'bw', paperSize: 'a4', duplex: false`) so the server
   prices the file (lines 434–455).

**Strengths.**
- Optimistic UI: placeholder appears before the network call (line 379).
- Per-file progress bar (`FileCard` lines 1463–1468).
- Defense-in-depth: server checks the storageKey is in the order's own
  namespace (`files/route.ts` lines 47–53) — blocks cross-order attacks
  within a shop.
- Page count parsed server-side via pdf-lib (only for PDFs); images = 1;
  Office = `null` → `needs_review` (`parse-page-count.ts` lines 13–23).

**P0-02. No client-side validation before minting the upload URL.**
`handleFiles` (line 353) iterates files and immediately calls the
upload-url endpoint without checking MIME type or size. A 26MB file or
an `.exe` will hit the server, be rejected (lines 38–43), and the
customer sees the raw server error message (line 390: `uu.data?.error?.message`).
**Fix:** validate `ALLOWED_UPLOAD_MIME_TYPES` and `MAX_UPLOAD_SIZE_BYTES`
client-side (import from `@platform/core/domain/file`) before the
presign call. Surface a friendly "Files must be PDF, image, or Office
document, max 25MB" message.

**P0-03. No upload cancellation.** ~~The XHR is created inside a Promise
(lines 394–408) but the `xhr` reference is never stored on the
`LocalFile`. There is no Cancel button.~~ **[RESOLVED in Phase 6.1]**
Upload cancellation is now implemented: a `uploadXhrsRef` (Map of
placeholderId → XMLHttpRequest) tracks every in-flight upload, and a
Cancel button (`aria-label="Cancel upload"`, 44×44px tap target) on
each uploading card calls `cancelUpload()` which aborts the XHR +
marks the file `failed` with `'Upload cancelled'`. See
`docs/ux/PHASE_6_1_VERIFICATION.md` §3.

**P1-05. No per-file retry.** ~~On failure, the card transitions to
`status: 'failed'` with the error message (line 458) but no Retry
button.~~ **[RESOLVED in Phase 6.1]**
Per-file retry is now implemented: failed cards with a preserved
`rawFile` show a Retry button (`aria-label="Retry upload"`, 44×44px
tap target). `retryUpload()` re-invokes `uploadOne()` with the failed
entry's preserved `rawFile`, minting a FRESH presigned URL (never
reuses an expired one). See `docs/ux/PHASE_6_1_VERIFICATION.md` §3.

**P1-06. `removeFile` does not delete server-side.** `removeFile`
(line 464–467) only filters the local array. The file row and the
storage object remain. The comment acknowledges this: "The API has no
delete-file endpoint; the file is left out of the priced set."
Consequence: if the customer removes a file and then adds another,
both are priced at checkout? No — checkout prices via
`repos.files.findByOrder` (checkout/route.ts line 45), which returns
both the removed file and the new one. The removed file's `pricePaise`
is whatever it was when last PATCHed; if it was never priced, the
"X file(s) have no price" check (line 47–50) trips. **Fix:** add
`DELETE /api/v1/orders/{id}/files/{fileId}` and call it from
`removeFile`.

**P1-07. Max file count not enforced.** The upload-url endpoint is
rate-limited at 30/min (upload-url/route.ts line 25) but there is no
cap on the number of files per order. A customer could upload 1000
files. Pricing still works (sum of file prices), but the UI will
render 1000 cards and the checkout table will be unusable. **Fix:**
cap at, say, 20 files per order; surface "You can upload up to 20
files per order" in the UI.

---

## 6. File selection and validation

**Server-side.**
- `ALLOWED_UPLOAD_MIME_TYPES` (file.ts lines 50–78): PDF, 6 image
  formats, 6 Office formats (.doc/.docx/.ppt/.pptx/.xls/.xlsx), 3
  OpenDocument formats, RTF, plain text, CSV, Outlook .msg, LaTeX .tex.
- `MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024` (line 103).
- `validateUploadRequest` (validation.ts lines 16–24) checks both.
- `files/route.ts` lines 56–60 re-validates: HEAD the object, check
  size match (declared vs stored). Catches truncated uploads.

**Client-side.**
- The `<input accept="...">` (line 844) lists the same extensions. Good.
- No MIME sniffing. A file renamed `.pdf` but actually an `.exe` will
  pass the `accept` filter (which is extension-based), pass the server
  MIME check (because the browser sends `application/pdf` based on the
  extension), and only fail when pdf-lib tries to parse it
  (`parse-page-count.ts` line 15 → catches → returns `null` →
  `needs_review`). Acceptable — the file is stored but flagged.

**P1-08. No duplicate-file detection.** A customer can pick the same
file twice; both upload; both get distinct `fileId`s; both are priced.
**Fix:** compare `file.name + file.size + file.lastModified` against
existing `LocalFile`s before minting a URL; surface "You've already
added {filename}".

---

## 7. Document storage (presigned URLs)

- `getContainer().storage.getPresignedUploadUrl({ key, contentType,
  contentLength, expiresInSeconds: 300 })` (upload-url/route.ts line 47).
- Storage adapters: R2, S3, Supabase, InMemory, Disabled
  (`packages/adapters/src/storage/*`). In dev, InMemory returns a
  relative `/api/v1/storage/put?...` URL (upload-lifecycle.test.ts line
  33); in production, returns an absolute cross-origin URL.
- CSP: per `src/lib/upload-lifecycle.test.ts` lines 9–13, the production
  CSP was amended to allow the Supabase origin in `connect-src` and
  `img-src` so the XHR PUT and the PDF preview image can reach the
  cross-origin storage.
- The `key` is `shops/{shopId}/orders/{orderId}/{fileId}` (line 46) —
  per-order namespace, verified at confirm time (lines 47–53).

**P2-04. No resumable uploads.** A 25MB upload that fails at 24MB must
restart from 0. For a customer on 2G/3G this is painful. **Future:**
S3 multipart / R2 multipart presigned URLs.

---

## 8. Document preview — `src/components/portal/pdf-preview.tsx` (395 lines)

**Strengths.**
- PDF.js in a Web Worker (lines 82–91), dynamic import keeps initial
  bundle small.
- 5-pages-per-view pagination (line 23, `PAGES_PER_VIEW = 5`) with
  prev/next + numbered page dots (lines 337–375).
- Per-page selection (click thumbnail to toggle, lines 150–162).
- "Select all / Deselect all" controls (lines 165–175).
- Image preview path (lines 188–210) and unsupported-file placeholder
  (lines 213–232).

**P0-04. Page-selection thumbnails are not keyboard-accessible.**
Line 300: `<div ... onClick={() => togglePage(pageNum)}>`. No `role`,
no `tabIndex`, no `aria-checked`, no keyboard handler. WCAG 2.2 SC 4.1.2
(Level A, "Name, Role, Value") fails. **Fix:** convert to
`<button role="checkbox" aria-checked={isSelected}
  aria-label={`Page ${pageNum}`}
  onClick={...} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePage(pageNum); } }}>`.

**P0-05. Design tokens bypassed.** The component hard-codes:
- `border-green-500`, `bg-green-600`, `border-green-400` (lines 302,
  320, 321) — should be `border-success`, `bg-success`,
  `border-success`.
- `text-amber-700`, `bg-amber-500` placeholder (lines 248, 383) —
  should be `text-warning`, `bg-warning`.
- `text-red-500` (line 389) — should be `text-danger`.
- `bg-gradient-to-t from-black/70 to-transparent` (line 328) — the
  design system forbids decorative gradients.
- `bg-green-600 text-white` for the image-preview check badge (line 201)
  — bypasses tokens.

**P1-09. Preview only works before the first refresh.** `ConfigureStep`
renders `PdfPreview` only when `f.rawFile` exists (line 928). After a
page refresh, `rawFile` is `undefined` (it is not persisted), so the
preview disappears. The `fileUrl` prop exists in the component signature
(line 14) but is not wired by `ConfigureStep`. **Fix:** fetch a
presigned GET URL from the server (a `GET
/api/v1/orders/{id}/files/{fileId}/preview-url` endpoint would be
needed) and pass it as `fileUrl`.

**P1-10. No zoom.** ~~Thumbnails are rendered at scale 0.5 (line 113).
A customer cannot zoom in to verify small text on a page.~~ **[RESOLVED in Phase 6.1]**
Zoom in/out (0.25 → 2.0, step 0.25), fit-to-width (reset to 1.0), and
clear-selection (Eraser icon) are now implemented in the PdfPreview
toolbar. Zoom is applied as a CSS `transform: scale()` on the
thumbnail wrapper (so PDF.js doesn't have to re-render the canvas).
The current zoom percentage is displayed next to the buttons with
`aria-live="polite"`. See `docs/ux/PHASE_6_1_VERIFICATION.md` §4.

**P2-05. Pagination dots are below the 44px tap target.** Line 354:
`h-8 min-w-8` (32px). WCAG 2.2 SC 2.5.8 (Level AA) requires 44px.
**Fix:** `h-11 min-w-11` or wrap in a larger padding hit area.

**P2-06. Per-page rendering is sequential and blocking.** Lines 109–129
loop pages 1..N, awaiting `page.render(...)` for each. A 200-page PDF
will take seconds; the UI shows a spinner but no progress indicator
for the render phase.

---

## 9. Page selection — two competing mechanisms

**Mechanism A — per-page checkboxes.** `PdfPreview` exposes
`onSelectionChange(selectedPages: number[])` (line 18). The
`ConfigureStep` wires it to `props.onUpdate(f.fileId, { selectedPages,
dirty: true })` (orders/[id]/page.tsx lines 933–935).

**Mechanism B — free-text page range.** `FileCard` (in the upload step)
has a `<Input type="text" placeholder="e.g. 1-5, 8, 12-14">` (lines
1525–1534). The `updateFile` handler converts a `selectedPages` array
to a compressed range string `"1-3,5-6"` (lines 488–503) before
PATCHing, and converts a `pageRange` string to `null` if empty
(lines 504–506).

**P0-06. The two mechanisms do not sync.** If the customer uses the
checkboxes in `ConfigureStep`, the `pageRange` text input in
`FileCard` (upload step) is never updated with the compressed range —
they see whatever was last typed. If the customer types in the
`pageRange` input, the `selectedPages` array in `PdfPreview` is never
updated, so the checkboxes do not reflect the typed range. Whichever
step the customer is in shows the wrong state.

**P1-11. `displayPriceForFile` ignores `selectedPages`.** The
`FileCard` price calculation (lines 1552–1568) uses `f.pageCount`, not
`f.selectedPages.length`. So a customer who deselects 100 of 200 pages
in `ConfigureStep` still sees the price for 200 pages on the upload
step. Only the server PATCH (which uses `pageRange`) recomputes
correctly. The `clientEstimate` function (lines 327–346) *does* use
`selectedPages` correctly, but `displayPriceForFile` does not.

---

## 10. Print options — colour, duplex, paper size, copies

**Domain.** `ColorMode = 'bw' | 'color'` (enums.ts line 80).
`PaperSize = 'a4' | 'a3' | 'letter' | 'legal'` (line 83). Duplex is a
boolean. Copies 1–500 (PatchFileSchema, file/[fileId]/route.ts line 11).

**Strengths.** All four settings are PATCHed to the server, which
recomputes the price via `priceFile` (file/[fileId]/route.ts lines 51–59)
and the order total (lines 67–69). The client never sends a price.

**P1-12. Paper-size control is inconsistent.**
- `ConfigureStep` (lines 966–975): native `<select>` with `h-11
  sm:h-9` and `border-input` styling — not the shadcn `Select`
  component.
- `FileCard` (lines 1498–1511): `ToggleGroup` with four
  `ToggleGroupItem`s (A4, A3, LTR, LGL).
Same setting, two different controls. Pick one.

**P1-13. Colour label inconsistency.** `FileCard` renders "Color"
(line 1495); `ConfigureStep` renders "Colour" (line 961). Pick the
British spelling ("Colour") consistently — it matches the marketing
copy on the home page (line 62: "Choose black-and-white or colour").

**P1-14. Copies input allows non-integer / 0.** `FileCard` line 1480:
`Math.max(1, Number(e.target.value) || 1)` — clamps to 1, but the
server validates `min(1).max(500)` (file/[fileId]/route.ts line 11).
A customer who types `499.5` will have `Number(499.5) = 499.5` sent
to the server, which will reject with a Zod error. **Fix:** use
`Math.floor` and clamp to 1–500.

**P2-07. No conditional disclosure.** The page range field is shown
unconditionally, even when `pageCount` is unknown (`needs_review`).
A customer cannot meaningfully type a page range when the page count
is unknown.

---

## 11. Pricing calculations — `packages/core/src/pricing/pricing-engine.ts`

**Algorithm** (breakdown.ts lines 15–46, pricing-engine.ts lines 22–69):
1. `baseRate = cfg[colorMode_paperSize_per_page]` (resolveBaseRate).
2. `totalPages = pages × copies`.
3. `gross = baseRate × totalPages` (rounded half-up to paise).
4. Duplex discount: `gross × cfg.duplex_discount / 100` if `duplex` and
   discount > 0.
5. Bulk discount: `(gross − duplexSaving) × cfg.bulk_discount_pct / 100`
   if `totalPages ≥ cfg.bulk_threshold` and pct > 0.
6. Min order adjustment: if subtotal < `min_order_value`, round up.
7. Line items: base print, duplex discount (negative), bulk discount
   (negative), min order adjustment (positive).

**Strengths.**
- All math in integer paise (no float drift).
- Round half-up (not banker's rounding) — predictable for customers.
- Bulk discount applies to the *post-duplex* subtotal — correct.
- Min order value rounds up by default (`DEFAULT_PRICING_BEHAVIOUR`,
  breakdown.ts line 5) — kinder than rejecting.

**P1-15. `pageRange` is parsed by the server but not validated.** ~~The
`PatchFileSchema` (file/[fileId]/route.ts line 13) accepts any
string ≤100 chars. The pricing engine uses `file.pageCount` (line 52),
not the parsed page range.~~ **[RESOLVED in Phase 6.1]**
The PATCH endpoint now uses `resolveBillablePages()` from
`src/lib/pricing/page-selection.ts` to parse + validate the `pageRange`
against `file.pageCount`. The resulting `billablePages` (NOT
`file.pageCount`) is the `PricingInput.pages` value. The checkout route
sources the amount exclusively from `order.totalAmountPaise`
(server-persisted, never client-supplied — the request body is not
even JSON-parsed). 31 new tests (21 unit + 10 integration) including
a price-tampering rejection test. See
`docs/ux/PHASE_6_1_VERIFICATION.md` §2.

**P2-08. `pageRange` parsing happens only client-side.** The
`updateFile` handler in the order page (lines 488–503) compresses the
`selectedPages` array into a range string before PATCHing, but the
server does not parse the string back into a count. There is no
shared `parsePageRange` utility.

---

## 12. Cart / order summary

**Upload step** (lines 877–898): sticky bar with "Estimated total" +
"Skip to checkout" + "Configure files" buttons.
**Configure step** (lines 1006–1021): same sticky bar with "Back" +
"Review & checkout".
**Checkout step** (lines 1047–1082): table with one row per priced file,
filename + settings summary + price, and a `<tfoot>` row with the
server-confirmed total.

**P1-16. "Skip to checkout" bypasses configuration.** The button (line
891) jumps from upload straight to checkout. If files have not been
auto-PATCHed (e.g., `needs_review`), checkout will reject with "X
file(s) have no price" (checkout/route.ts line 49). The error is shown
as a generic banner (line 1096) — the customer cannot tell which file
needs attention. **Fix:** disable "Skip to checkout" until all files
have `pricePaise > 0`, or surface the error inline at each unpriced
file card.

**P2-09. No "estimated savings" display.** When duplex or bulk
discounts apply, the line items show the discount as a negative row,
but the file card price display (line 999) shows only the final
`pricePaise`. A customer who would benefit from duplex (e.g., "save ₹40
by switching to double-sided") gets no nudge.

---

## 13. Checkout and payment — `checkout/route.ts` + `PayStep`

**Server (checkout/route.ts, 152 lines).**
- Validates order is `awaiting_payment` (line 37).
- Validates shop has UPI VPA (line 43).
- Validates files exist and all are priced (lines 45–50).
- Generates `merchantOrderId` BEFORE contacting the provider (line 57).
- Persists `PaymentAttempt` BEFORE contacting the provider (lines 62–86,
  fail-closed: aborts if persistence fails).
- Contacts the provider adapter (lines 90–99).
- Falls back to a UPI deep-link if the adapter returned no `upiUri`
  (lines 103–114).
- Caches merchantOrderId → order (line 119).

**Client (`PayStep`, lines 1117–1252).**
- Two payment options: "Pay by UPI App" button (launches `upiUri` via
  `window.location.href = upiUri`, line 1136) and "Scan QR Code"
  (renders the shopkeeper's uploaded QR if present, else the generated
  QR from `/api/v1/qr`).
- UPI ID manual fallback displayed (lines 1212–1217).
- "I've paid" button moves to track step (line 576–588) — does NOT
  verify payment. The order remains `awaiting_payment` until the
  shopkeeper verifies or a provider webhook confirms.

**Strengths.**
- Fail-closed payment attempt persistence (no orphaned intents).
- Two distinct payment paths (deep-link + QR) with sensible fallback.
- `customerToken` is the `tn` (transaction note) field in the UPI
  deep-link (line 109) — the shopkeeper sees the token in their UPI
  app statement, which helps manual verification.

**P0-07. No duplicate-submit protection on "Create payment".** The
`doCheckout` callback (line 535) sets `busy=true` (line 536) but does
not guard against the customer clicking again before the first request
returns. The button is `disabled={props.busy || priced.length === 0}`
(line 1107), so a fast double-click is blocked — but a slow network
where the customer navigates back and clicks again would create two
`PaymentAttempt` rows. The server-side `isUniqueConstraintError` check
(line 77) collapses UUID collisions (vanishingly rare) but not
legitimate duplicate attempts with distinct `merchantOrderId`s. **Fix:**
idempotency key on the checkout request, or check for an existing
non-terminal `PaymentAttempt` for the order before creating a new one.

**P1-17. `expiresAt` not surfaced in the UI.** The checkout response
includes `expiresAt` (10-minute payment window, checkout/route.ts line
73). The PayStep does not display it. A customer who steps away to find
the shopkeeper and comes back in 15 minutes will see a stale QR. **Fix:**
show "This payment link expires in 9:42" with a countdown, and disable
the "I've paid" button after expiry.

**P1-18. The QR generator fallback uses a separate request.** If the
shopkeeper has no uploaded QR, `doCheckout` calls `/api/v1/qr?data=...`
(line 563) to generate one. This is a second network round-trip after
checkout. **Fix:** have the checkout endpoint embed the QR data URL in
its response when no provider QR is available.

**P2-10. The "Pay {amount} with UPI" button** (line 1169) uses
`bg-success text-success shadow-md` — correct tokens — but is a raw
`<button>` not the shadcn `Button`. Inconsistent with the rest of the
app. **Fix:** use `<Button variant="default" className="bg-success
text-success-foreground">`.

---

## 14. Order confirmation and tracking — `TrackStep` (lines 1254–1402)

**Strengths.**
- Token displayed prominently (`tokenNumber ?? customerToken`, line 1278)
  with "Show this at the counter" instruction (line 1280).
- Payment status separated from order status (lines 1283–1332). Payment
  pending = amber clock; payment confirmed = green checkmark + time +
  UTR + manual-vs-auto verification badge.
- Order status: terminal (ready/collected) = green; cancelled/refunded =
  red; in-flight = spinner + brand colour.
- Auto-poll every 30 seconds (line 601), stops on terminal states
  (line 599).
- "Refreshed every 30 seconds" copy (line 1271) — matches the actual
  cadence.
- Receipt download (`downloadReceipt`, lines 606–622) — fetches bytes
  via the authenticated route, creates a Blob, triggers a download.
- "Back to home" link (line 1394).

**P1-19. `aria-live` missing on the order-status card.** When the
order transitions from `printing` to `ready`, a screen-reader user is
not notified. **Fix:** add `aria-live="polite"` to the order-status
`<div>` (line 1326).

**P1-20. No "next action" guidance.** The status card shows the
current state but not what the customer should do. When status is
`ready`, the card should say "Collect your prints at the counter —
show your token {tokenNumber}." When `awaiting_payment` (customer
tapped "I've paid" but shopkeeper hasn't verified yet), it should say
"Wait for the shopkeeper to confirm your payment."

**P2-11. Polling cadence is slow for active tracking.** 30 seconds is
a long wait when the customer is standing at the counter. The comment
(line 601) explains it is "optimized for 500 shops on free tier" —
database load. Consider an exponential back-off: 5s for the first
minute after payment, then 30s.

**P2-12. Files table in track step** (lines 1347–1375) shows filename +
`FileStatusBadge` but not the per-file settings (copies, colour, etc).
A customer cannot verify "did I order colour or B&W?" from the track
page.

---

## 15. Mobile and responsive layouts

**Strengths.**
- `min-h-[44px]` applied to virtually every button (grep: 21
  occurrences in orders/[id]/page.tsx, 4 in shops/[slug]/page.tsx,
  6 in page.tsx).
- Settings grids collapse `lg:grid-cols-4 → sm:grid-cols-2 →
  grid-cols-1`.
- Tables wrapped in `overflow-x-auto` with `min-w-[Npx]` so they
  scroll horizontally on mobile (checkout table line 1047, pricing
  table line 250, files table line 1350).
- Stepper labels drop from `text-xs` to `text-[10px]` on mobile
  (line 786) — tight but legible.

**P1-21. PDF preview thumbnail grid is fixed at 5 columns** (line 293:
`grid grid-cols-5 gap-2`). On a 360px viewport, each thumbnail is
~60px wide — too small to read content. **Fix:** `grid-cols-2 sm:grid-cols-5`
or make `PAGES_PER_VIEW` responsive.

**P1-22. The PayStep "two options" grid** (line 1157:
`grid-cols-1 sm:grid-cols-2`) stacks on mobile. Good. But the UPI-app
button is full-width on mobile (line 1169: `w-full`) and the QR card
is also full-width below it — the customer scrolls past the UPI button
to reach the QR. If the customer is on desktop (no UPI app installed),
the QR is the right-hand column. Acceptable.

**P2-13. Header is `h-12 sm:h-16`** (line 628) — 48px on mobile. The
"Home" link inside is `min-h-[44px]` (line 629), so the link's hit area
extends below the header on mobile. Visually fine but unusual.

---

## 16. Cross-cutting issues

**P1-23. The `useApiClient` re-export file is misleading.**
`src/components/portal/use-api-client.ts` is a 7-line re-export from
`./auth-context` (lines 1–7). A developer grepping for `useApiClient`
will land here and may not realise the actual implementation is in
`auth-context.tsx` (234 lines, with auto-refresh-on-401 logic). Not a
user-facing issue but a maintainability trap.

**P1-24. `tailwind.config.ts` is dead.** Per `docs/DESIGN_SYSTEM.md`
§2.4, the file is a Tailwind v3 leftover with `hsl(var(--*))` wrappers
around OKLCH values. Tailwind v4 reads tokens from `@theme inline` in
`globals.css`. The config is ignored at runtime but still consulted by
some IDE plugins and may confuse contributors. **Fix:** delete or
rewrite as a no-op.

**P2-14. No toast notifications on the customer journey.** The shopkeeper
portal uses Sonner toasts (`<Toaster />` in layout); the customer pages
do not show toasts for "Settings saved", "File removed", "Payment link
created". The customer only sees inline banners. Consistent use of
toasts for non-blocking confirmations would improve feedback.

**P2-15. `customerToken` displayed as visible badge** — already fixed
per `docs/UX_AUDIT.md` finding #2. Verified: the order page header
(line 633–640) shows only `orderId.slice(0,8)` and `tokenNumber`, never
`customerToken`. Good.

**P2-16. "Demo mode" notice gated correctly.** The dev-mode payment
notice (line 671) is gated on `process.env.NODE_ENV !== 'production'`.
Verified.

---

## 17. Findings summary

| ID | Sev | Area | One-line summary |
|---|---|---|---|
| P0-01 | P0 | Auth | `customerToken` returned in `/status` response body |
| P0-02 | P0 | Upload | No client-side MIME/size validation before presign |
| P0-03 | P0 | Upload | No upload cancellation (XHR not abortable) — **RESOLVED in Phase 6.1** |
| P0-04 | P0 | Preview | PDF page thumbnails not keyboard-accessible (`<div onClick>`) |
| P0-05 | P0 | Preview | Design tokens bypassed (raw `green-500`, `amber-500`, gradient) |
| P0-06 | P0 | Pages | Checkbox selection and free-text page range do not sync |
| P0-07 | P0 | Checkout | No idempotency on "Create payment" |
| P1-01 | P1 | Home | Shop list capped at 50, no pagination UI |
| P1-02 | P1 | Shop | Order-creation redirect leaves `?t=` in shop-page history |
| P1-03 | P1 | Shop | No loading state during order-page hydration |
| P1-04 | P1 | Auth | `sessionStorage` token not cleared on terminal status |
| P1-05 | P1 | Upload | No per-file retry button — **RESOLVED in Phase 6.1** |
| P1-06 | P1 | Upload | `removeFile` does not delete server-side |
| P1-07 | P1 | Upload | No max file count per order |
| P1-08 | P1 | Upload | No duplicate-file detection |
| P1-09 | P1 | Preview | Preview lost on page refresh (`rawFile` not persisted) |
| P1-10 | P1 | Preview | No zoom control — **RESOLVED in Phase 6.1** |
| P1-11 | P1 | Pages | `displayPriceForFile` ignores `selectedPages` |
| P1-12 | P1 | Settings | Paper-size control inconsistent (`<select>` vs `ToggleGroup`) |
| P1-13 | P1 | Settings | "Color" vs "Colour" label inconsistency |
| P1-14 | P1 | Settings | Copies input allows non-integer values |
| P1-15 | P1 | Pricing | `pageRange` never affects the price (revenue bug) — **RESOLVED in Phase 6.1** |
| P1-16 | P1 | Cart | "Skip to checkout" surfaces generic error on unpriced files |
| P1-17 | P1 | Checkout | `expiresAt` not surfaced in UI |
| P1-18 | P1 | Checkout | QR fallback adds a second round-trip |
| P1-19 | P1 | Track | No `aria-live` on order-status transitions |
| P1-20 | P1 | Track | No "next action" guidance per status |
| P1-21 | P1 | Mobile | PDF thumbnail grid fixed at 5 cols on mobile |
| P1-22 | P1 | Mobile | PayStep layout acceptable but verbose on mobile |
| P1-23 | P1 | DX | `use-api-client.ts` re-export hides the real implementation |
| P1-24 | P1 | DX | `tailwind.config.ts` is a dead v3 leftover |
| P2-01 | P2 | Home | Dead `body` field in `TRUST_INDICATORS[3]` |
| P2-02 | P2 | Home | "I run a print shop" links to login, not register |
| P2-03 | P2 | Shop | Address shows `timezone` |
| P2-04 | P2 | Storage | No resumable uploads |
| P2-05 | P2 | Preview | Pagination dots below 44px tap target |
| P2-06 | P2 | Preview | Sequential page rendering, no progress for render phase |
| P2-07 | P2 | Settings | Page range shown when page count unknown |
| P2-08 | P2 | Pricing | No shared `parsePageRange` utility |
| P2-09 | P2 | Cart | No "estimated savings" display |
| P2-10 | P2 | Checkout | UPI button is a raw `<button>`, not shadcn `Button` |
| P2-11 | P2 | Track | Polling cadence slow for active tracking |
| P2-12 | P2 | Track | Files table omits per-file settings |
| P2-13 | P2 | Mobile | Header `h-12` on mobile is tight |
| P2-14 | P2 | UX | No toast notifications on customer journey |
| P2-15 | P2 | Auth | `customerToken` badge removed (verified fixed) |
| P2-16 | P2 | Auth | Dev-mode notice gated correctly (verified) |

**Counts:** 7 P0, 17 P1, 16 P2. The P0s cluster in three areas: upload
control (no cancel, no client validation), preview accessibility (div
checkbox, raw colours), and pricing correctness (page-range never
priced). These are the highest-leverage fixes.

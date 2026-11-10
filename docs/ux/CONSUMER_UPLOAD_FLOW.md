# Consumer Upload Flow — End-to-End Journey

> The complete upload-to-print journey as implemented in the PrintShop
> SaaS customer portal. Every step is grounded in the actual source
> code; line numbers refer to `src/app/orders/[id]/page.tsx` unless
> noted otherwise.
>
> **Entry point:** the customer scans a shop QR code → lands on
> `/shops/{slug}` → taps "Start order" → arrives at `/orders/{id}` with
> a `?t={customerToken}` query. From there the journey is a 5-step
> wizard: **Upload → Configure → Checkout → Pay → Track**.
>
> **Auth model:** the customer never logs in. The `customerToken`
> (issued at order creation in `src/app/api/v1/shops/[slug]/orders/route.ts`
> line 61) is the only credential. It is sent as the `X-Order-Token`
> header on every `/api/v1/orders/{id}/*` request
> (`orders/[id]/page.tsx` lines 211–214) and verified constant-time in
> `src/lib/api/with-order-access.ts` line 86.

---

## Step 0 — Order creation (before the wizard)

The customer lands on `/shops/{slug}` (`src/app/shops/[slug]/page.tsx`).
The shop detail page shows: shop name, UPI ID, payment provider, pricing
reference table (8 per-page rates + duplex discount + bulk threshold +
bulk discount + min order value), print options supported, and a sticky
"Start an order" card.

Tapping "Start order" (line 128) calls `POST /api/v1/shops/{slug}/orders`
with an empty body. The server:
1. Generates a 6-char uppercase `customerToken` with collision retry
   (`shops/[slug]/orders/route.ts` lines 61–68).
2. Allocates a per-shop sequential `tokenNumber` (e.g. "A104") with
   race-safe `createWithUniqueToken` (lines 75–80).
3. Returns `{orderId, customerToken, tokenNumber, status, shop}`.

The shop page then navigates to
`/orders/{orderId}?shop={slug}&t={customerToken}` (line 153). The order
page reads `?t=` on mount, persists it to `sessionStorage` keyed
`order-token:{orderId}`, and strips `?t=` from the URL so it does not
leak via history/referrer (lines 185–208).

---

## Step 1 — Upload

**UI:** `UploadStep` component (lines 794–901).

**Layout.**
- Card titled "Step 1 · Upload your files" with `UploadCloud` icon.
- Dropzone: `rounded-xl border-2 border-dashed p-4 sm:p-6` with
  `onDragOver`/`onDragLeave`/`onDrop` handlers (lines 824–850). The
  dropzone is decorative — not focusable, no role.
- "Browse files" button (`size="sm" variant="outline"`) triggers the
  hidden `<input type="file" multiple accept="...">` via
  `fileInputRef.current?.click()` (line 837).
- Accepted extensions (line 844): `.pdf, .doc, .docx, .ppt, .pptx,
  .xls, .xlsx, .odt, .ods, .odp, .rtf, .txt, .csv, .jpg, .jpeg, .png,
  .gif, .webp, .bmp, .tiff, .tif, .tex`.
- Helper text below: "PDF, images, Office docs, text — max 25MB per
  file."
- File list below the dropzone: each file rendered as a `FileCard`
  (lines 1417–1549). Empty state: a dashed card with `FileText` icon +
  "No files uploaded yet" (lines 861–868).
- Sticky summary bar at the bottom: "Estimated total" + "Skip to
  checkout" + "Configure files" buttons (lines 877–898).

**Upload pipeline** (`handleFiles`, lines 353–462):
For each selected file:
1. **Optimistic insert.** A placeholder `LocalFile` with
   `status: 'uploading'`, `uploadProgress: 0`, `rawFile: file` is
   appended to the files array (lines 359–379). The UI shows the card
   immediately with a spinner.
2. **Mint presigned URL.** `POST /api/v1/orders/{id}/files/upload-url`
   with `{filename, mimeType, size}` (lines 383–391). Server validates
   MIME + size (`upload-url/route.ts` lines 36–43), generates a
   `fileId` (UUID), builds a storage key
   `shops/{shopId}/orders/{orderId}/{fileId}` (line 46), and mints a
   presigned PUT URL with 300-second expiry (line 51).
3. **PUT the bytes.** XHR PUT to the presigned URL with
   `Content-Type` header and `upload.onprogress` callback that updates
   `uploadProgress` (lines 394–408). Progress bar visible on the card
   (`FileCard` lines 1463–1468).
4. **Confirm upload.** `POST /api/v1/orders/{id}/files` with
   `{fileId, storageKey, filename, mimeType, size}` (lines 411–419).
   Server:
   - Validates the `storageKey` is in this order's namespace
     (`files/route.ts` lines 47–53) — defense-in-depth against
     cross-order attacks.
   - HEADs the storage object to verify it landed (line 56) and that
     the stored size matches the declared size (line 58).
   - Parses the page count via `parsePageCount` (line 67):
     - PDF → `pdf-lib` `PDFDocument.load().getPageCount()` (returns
       `null` on parse failure → `needs_review`).
     - JPEG/PNG → `1`.
     - All other types → `null` → `needs_review`.
   - Creates the file row in the DB (lines 70–77).
   - If `needsReview`, sets `status: 'needs_review'` (lines 78–80).
   - Audit-logs `file.upload` (lines 82–90).
5. **Replace placeholder.** The optimistic placeholder's `fileId`,
   `pageCount`, `status`, `uploadProgress` are updated from the
   confirm response (lines 424–431).
6. **Auto-apply defaults + price.** If not `needs_review`, auto-PATCH
   with `{copies: 1, colorMode: 'bw', paperSize: 'a4', duplex: false}`
   (lines 434–455). The server recomputes the file's price via
   `priceFile` and the order total via sum of all file prices
   (`file/[fileId]/route.ts` lines 51–69). The patched values + new
   price are written back to the local state.

**On error** (lines 456–460): the placeholder transitions to
`status: 'failed'` with the error message stored in `uploadError`.
The card shows the error inline (`FileCard` line 1444–1446). The
error is also surfaced in a banner above the file list (lines 851–856).
There is no per-file retry button (audit P1-05). The `rawFile` is
retained, so retry is mechanically possible — UI not wired.

**On remove** (`removeFile`, lines 464–467): the local row is
filtered out. The server-side file row and storage object are **not**
deleted — there is no delete-file endpoint (audit P1-06).

**Validation — client-side.** None before the presign call (audit
P0-02). The browser's OS file picker filters by the `accept` attribute
(extension-based), but a 26MB file or an `.exe` renamed `.pdf` will
reach the server and be rejected with a raw error message.

**Validation — server-side** (`upload-url/route.ts` lines 36–43 +
`files/route.ts` lines 47–60):
| Check | Where | Failure behaviour |
|---|---|---|
| Filename length 1–255 | `UploadUrlSchema` (line 12) | 400 + Zod error |
| MIME in `ALLOWED_UPLOAD_MIME_TYPES` | line 38 | 400 + "Unsupported file type" |
| Size ≤ 25MB (`MAX_UPLOAD_SIZE_BYTES`) | line 41 | 400 + "File too large" |
| Order status = `awaiting_payment` | line 31 | 400 + "Order in status '...' cannot accept files" |
| `storageKey` in order namespace | `files/route.ts` line 48 | 400 + "storageKey must be in this order's namespace" |
| Object exists in storage (HEAD) | line 56 | 400 + "File not found in storage" |
| Stored size = declared size | line 58 | 400 + "Size mismatch" |
| Page count parseable | line 67 | `null` → `needs_review` status |

---

## Step 2 — Configure

**UI:** `ConfigureStep` component (lines 903–1024).

**Layout.** One card per file (`FileCard` shape reused). Each card shows:
- Filename + page-count badge (lines 918–924).
- `PdfPreview` (if `f.rawFile` exists, line 928) — renders PDF page
  thumbnails with per-page selection.
- Settings grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (line 940):
  - Copies (`Input type="number" min=1 max=500`, lines 943–950).
  - Colour (`ToggleGroup` B&W / Colour, lines 954–963).
  - Paper (native `<select>` A4/A3/Letter/Legal, lines 966–975 —
    inconsistent with `FileCard` which uses `ToggleGroup`; audit
    P1-12).
  - Sides (`ToggleGroup` Single / Double, lines 979–988).
- Price display row: "N of M pages selected" + price (lines 992–1001).
- Sticky footer: "Back" + "Review & checkout" (lines 1006–1021).

**PDF preview** (`src/components/portal/pdf-preview.tsx`):
- PDF.js loaded via dynamic `import('pdfjs-dist')` (line 82) in a Web
  Worker (lines 85–91).
- Each page rendered to a canvas at scale 0.5 (line 113) → JPEG data
  URL at quality 0.7 (line 122).
- 5 thumbnails per "view" with prev/next pagination + numbered dots
  (lines 293–375).
- Each thumbnail has a click-to-toggle selection checkbox (lines 300,
  317–325). Currently a `<div onClick>` — not keyboard accessible
  (audit P0-04).
- "Select all / Deselect all" controls (lines 273–289).
- "X / Y pages selected" badge + percentage (lines 265–269).
- Image preview path (lines 188–210): single thumbnail with a green
  check badge.
- Unsupported-file placeholder (lines 213–232): `FileText` icon +
  "Preview not available" + page count.

**Page selection** (`onSelectionChange` callback, line 933): when the
customer toggles pages in `PdfPreview`, the `selectedPages` array is
PATCHed to the server. `updateFile` (lines 470–532) compresses the
array into a range string (e.g., `[1,2,3,5,6]` → `"1-3,5-6"`, lines
488–503) before sending. The server stores `pageRange` but does not
parse it back into a count for pricing — **the price is still based on
`file.pageCount`, not the selected subset** (audit P1-15, revenue bug).

**Settings update** (`updateFile`, lines 470–532):
- Optimistic: local state updated immediately, `dirty: true` flag set
  (line 473).
- If file is `uploading` / `failed` / `needs_review`, the PATCH is
  deferred (lines 477–478).
- Server PATCH `/api/v1/orders/{id}/files/{fileId}` with the changed
  fields only (lines 482–506). Server validates via `PatchFileSchema`
  (`file/[fileId]/route.ts` lines 10–16), recomputes the file price
  via `priceFile` (lines 51–59), recomputes the order total as the sum
  of all file prices (lines 67–69), and returns the patched file + new
  total + line items (lines 71–82).
- On response, the local state is updated with the server-computed
  price, `dirty: false`, `patching: false` (lines 514–527).

**Live client-side estimate** (`clientEstimate`, lines 327–346):
while a file is `dirty` (PATCH in flight), the UI shows a client-side
estimate computed via the same `priceFile` function from
`@platform/core/pricing`. The estimate uses `selectedPages.length` if
available, else `pageCount` (lines 331–333). Once the server response
arrives, the estimate is replaced with the server-confirmed price.

**Pricing algorithm** (`packages/core/src/pricing/pricing-engine.ts` +
`breakdown.ts`):
1. `baseRate = cfg[colorMode_paperSize_per_page]` (e.g.,
   `bw_a4_per_page`).
2. `totalPages = pages × copies`.
3. `gross = baseRate × totalPages` (rounded half-up to paise).
4. If `duplex` and `cfg.duplex_discount > 0`:
   `duplexSaving = gross × duplex_discount / 100`.
5. If `totalPages ≥ cfg.bulk_threshold` and `cfg.bulk_discount_pct > 0`:
   `bulkSaving = (gross − duplexSaving) × bulk_discount_pct / 100`.
6. `subtotal = gross − duplexSaving − bulkSaving`.
7. If `subtotal < cfg.min_order_value`: `minOrderAdj = min_order_value
   − subtotal` (round-up behaviour by default).
8. `total = subtotal + minOrderAdj`.
9. Line items: base print, duplex discount (negative), bulk discount
   (negative), min order adjustment (positive).

All math in integer paise. The client never sends a price to the
server — only settings. The server is the sole authority.

---

## Step 3 — Checkout

**UI:** `CheckoutStep` component (lines 1026–1115).

**Layout.**
- Card titled "Step 3 · Review & checkout" with `CreditCard` icon.
- Description: "The server recalculates the final price at checkout. We
  never trust the client's number." (line 1043).
- Line-items table (lines 1047–1082): one row per priced file with
  filename + page count, settings summary
  (`{copies}× · {B&W/Colour} · {paperSize} · {duplex?} · {pageRange?}`),
  and price. `<tfoot>` row with "Server-confirmed total" + the total
  amount. Wrapped in `overflow-x-auto` with `min-w-[480px]` for mobile
  horizontal scroll.
- Shop payment info box (lines 1084–1094): `ShieldCheck` icon + "Pay to
  `{upiId}` · `{shopName}`" + provider name + "zero commission".
- Error banner if checkout failed (lines 1096–1101).
- Footer: "Back" + "Create payment" buttons (lines 1103–1111). The
  "Create payment" button is disabled while `busy` or if no files are
  priced.

**Action:** `doCheckout` (lines 535–567):
1. `POST /api/v1/orders/{id}/checkout` with no body (just the
   `X-Order-Token` header).
2. Server (`checkout/route.ts`):
   - Validates order is `awaiting_payment` (line 37).
   - Validates shop has UPI VPA (line 43).
   - Validates files exist and all are priced (lines 45–50). If any
     file has `pricePaise === 0`, returns 400 with "X file(s) have no
     price — set print settings first" (line 49).
   - Generates `merchantOrderId = crypto.randomUUID()` BEFORE
     contacting the provider (line 57).
   - **Fail-closed:** persists `PaymentAttempt` to the DB BEFORE
     contacting the provider (lines 62–86). If persistence fails
     (non-duplicate), aborts checkout without contacting the provider
     (line 84).
   - Contacts the provider adapter (`adapter.createPaymentIntent`,
     lines 90–99).
   - If the adapter returned no `upiUri`, generates a UPI deep-link
     fallback from the shop's UPI ID with `pa` (payee address), `pn`
     (payee name), `am` (amount), `cu` (currency), `tn` (transaction
     note = `customerToken`), `tr` (transaction reference =
     `merchantOrderId`) (lines 103–114).
   - Caches `merchantOrderId → order` mapping for fast webhook lookup
     (line 119).
   - Audit-logs `order.checkout` (lines 126–134).
   - Returns `{orderId, merchantOrderId, amountPaise, currency,
     provider, checkoutUrl, upiUri, qrPayload, expiresAt}`.
3. Client receives the checkout response, stores it in `checkout`
   state (line 546).
4. Fetches the shopkeeper's uploaded UPI QR (if any) from
   `GET /api/v1/shops/{slug}/upi-qr` (lines 552–557). If present,
   `shopkeeperQrUrl` is set.
5. Generates a QR code from the `upiUri` (or `qrPayload`) via
   `GET /api/v1/qr?data={payload}` (lines 561–564). Sets `qrDataUrl`.
6. Advances to the pay step (`setStep('pay')`, line 566).

**Duplicate-submit protection** (audit P0-07): the button is
`disabled={props.busy || priced.length === 0}` (line 1107), so a fast
double-click is blocked. But there is no idempotency key on the
request — a slow network where the customer navigates back and clicks
again would create two `PaymentAttempt` rows.

---

## Step 4 — Pay

**UI:** `PayStep` component (lines 1117–1252).

**Layout.**
- Card titled "Step 4 · Pay {shopName}" with `QrCode` icon, brand-accent
  border.
- Amount panel (lines 1150–1154): `bg-brand-soft ring-1 ring-brand/30`,
  large amount (`text-3xl sm:text-4xl lg:text-5xl font-bold`), "direct
  to shopkeeper's UPI · 0% commission" caption.
- Two payment options in a `grid-cols-1 sm:grid-cols-2` (line 1157):
  - **Option 1: Pay by UPI App** (lines 1159–1178): green-accented
    panel with `Smartphone` icon. A `bg-success text-success-foreground`
    button labelled "Pay {amount} with UPI" launches `window.location.href
    = upiUri` (line 1136) — opens the customer's UPI app (GPay, PhonePe,
    Paytm) with the amount prefilled.
  - **Option 2: Scan QR Code** (lines 1181–1209): brand-accented panel
    with `QrCode` icon. Renders the shopkeeper's uploaded QR
    (`shopkeeperQrUrl`) if present, else the generated QR (`qrDataUrl`).
    If neither is ready yet, shows a spinner. If no QR at all, shows
    "No QR".
- UPI ID manual fallback (lines 1212–1217): "Or enter UPI ID manually
  in your app: {upiId}".
- Payment notice (lines 1221–1231): brand-accented info box — "After
  paying, tap 'I've paid' below. Your payment stays Pending until
  verified."
- Error banner if `paymentError` (lines 1233–1238).
- Footer: "Back" + "I've paid — track my order" buttons (lines
  1240–1248). The latter is disabled while `busy` or if `simulated`.

**Action:** `doPay` (lines 576–588):
- **Does NOT verify payment.** Sets `step` to `'track'` and triggers a
  silent status refresh. The order remains `awaiting_payment` until
  the shopkeeper manually verifies the UPI receipt (or a verified
  provider webhook confirms). The customer has explicitly told the
  system "I've paid"; the system does not trust this for state
  transitions.

**Dev-mode payment simulation:** in non-production environments, the
track step exposes a "Simulate payment" affordance that calls `POST
/api/v1/dev/phonepe/simulate` or `/dev/paytm/simulate`. Gated behind
`requireDev()` (`src/lib/api/require-dev.ts`). The dev notice on the
upload/configure/checkout steps (line 671) reminds the developer this
is available.

---

## Step 5 — Track

**UI:** `TrackStep` component (lines 1254–1402).

**Layout.**
- Card titled "Step 5 · Track your order" with status-icon prefix
  (green check / red X / spinning loader).
- Token display (lines 1275–1281): `bg-muted/60` panel with "Your
  token" label + the canonical `tokenNumber ?? customerToken` in
  `font-mono text-2xl sm:text-3xl sm:tracking-widest font-bold
  text-brand` + "Show this at the counter."
- **Payment status card** (lines 1283–1320): separate from order
  status. Green check + "Payment Confirmed {time} · UTR {utr}" if
  `paidAt !== null`; amber clock + "Payment Pending — The shopkeeper
  will verify your UPI payment after you pay" if `paidAt === null`.
  Auto/manual verification badge (lines 1307–1313): "Auto-verified"
  (green) or "Manual verification" (brand) based on whether
  `paymentTxnId` starts with `manual-`.
- **Order status card** (lines 1322–1332): `bg-{token}-soft ring-1
  ring-{token}/30` with status-icon + `statusLabel(s)` + raw status
  text. Green for terminal success, red for terminal negative, brand
  + spinner for in-flight.
- Order ID + amount grid (lines 1334–1344).
- Files table (lines 1347–1375): filename + `FileStatusBadge` per
  file. Wrapped in `overflow-x-auto` with `min-w-[320px]`.
- Error banner if `trackError` (lines 1377–1382).
- Footer: "Refresh" + (if terminal) "Download receipt" + "Back to
  home" (lines 1384–1397).

**Status labels** (`statusLabel`, lines 154–165):
| Status | Label |
|---|---|
| `awaiting_payment` | "Awaiting payment" |
| `paid` | "Payment confirmed" |
| `printing` | "Printing now" |
| `ready` | "Ready to collect" |
| `collected` | "Collected — thank you!" |
| `cancelled` | "Cancelled" |
| `refunded` | "Refunded" |

**Polling** (lines 591–603):
- `refreshStatus` calls `loadOrder({ silent: true })` — re-fetches
  `GET /api/v1/orders/{id}/status` without showing the loading
  skeleton.
- Auto-poll: every 30 seconds while `step === 'track'` and the order
  is not in a terminal state (`collected`, `cancelled`, `refunded`).
  The interval is cleared on unmount or when the order reaches a
  terminal state (line 599).
- The 30-second cadence is documented in the UI ("Refreshed every 30
  seconds", line 1271) and in a code comment as "optimized for 500
  shops on free tier" (line 601).

**Receipt download** (`downloadReceipt`, lines 606–622):
- `GET /api/v1/orders/{id}/receipt` with `raw: 'bytes'` and the
  `X-Order-Token` header.
- The response is a PDF blob; an object URL is created and a
  temporary `<a download>` is clicked to trigger the browser download.
- The download is only shown when the order is terminal (`done` =
  `ready` or `collected`, line 1261).

**Token clearing** (audit P1-04): the `sessionStorage` entry
`order-token:{orderId}` is never cleared. On a terminal status, it
should be removed so a subsequent order in the same tab does not
accumulate stale tokens.

---

## Cross-step invariants

1. **Server-authoritative pricing.** The client may show an estimate
   while a PATCH is in flight (`dirty: true`), but every persisted
   price comes from the server's `priceFile` call. The checkout total
   is read from `order.totalAmountPaise` on the server
   (`checkout/route.ts` line 70), never from the client.
2. **Per-order access token.** Every `/api/v1/orders/{id}/*` request
   carries `X-Order-Token`. The middleware
   (`src/lib/api/with-order-access.ts`) constant-time-compares it
   before the handler runs.
3. **Order immutability after checkout.** The file-PATCH endpoint
   rejects PATCHes when `order.status !== 'awaiting_payment'`
   (`file/[fileId]/route.ts` line 33). The upload-url and confirm
   endpoints reject similarly. Once checkout is created, the customer
   cannot change settings.
4. **Audit trail.** Every mutation (`file.upload`, `order.checkout`)
   is audit-logged with shopId, action, entityType, entityId,
   metadata, and IP (`upload-url/route.ts` line 82, `checkout/route.ts`
   line 126).
5. **Rate limiting.** Every customer-facing order route is wrapped in
   `withRateLimit`: upload-url 30/min, confirm-file 30/min, patch-file
   60/min, checkout 20/min, status 120/min (per-order, per-IP).

---

## Known limitations (cross-reference to audit)

| Limitation | Audit ID | Impact |
|---|---|---|
| No client-side MIME/size validation | P0-02 | Bad files reach the server, customer sees raw error |
| No upload cancellation | P0-03 | Customer must wait for stuck upload to finish |
| PDF preview not keyboard-accessible | P0-04 | WCAG 2.2 SC 4.1.2 failure |
| Preview design tokens bypassed | P0-05 | Visual inconsistency with the rest of the app |
| Checkbox + page-range do not sync | P0-06 | Customer sees stale state in one of the two UIs |
| `pageRange` never affects price | P1-15 | Customer pays for pages they didn't select |
| No per-file retry button | P1-05 | Customer must remove + re-pick on failure |
| `removeFile` doesn't delete server-side | P1-06 | Orphaned files affect checkout pricing |
| Preview lost on refresh | P1-09 | Customer cannot preview after a page reload |
| No idempotency on checkout | P0-07 | Duplicate `PaymentAttempt` rows possible |
| `expiresAt` not shown | P1-17 | Customer may scan an expired QR |
| No `aria-live` on status transitions | P1-19 | Screen-reader users not notified of status changes |

See `docs/ux/CONSUMER_UX_AUDIT.md` §17 for the full findings table.

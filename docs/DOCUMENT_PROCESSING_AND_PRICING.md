# Document Processing and Pricing

## Root Cause of ₹0.00 Pricing Issue

When a customer uploads a `.doc` file (legacy Word binary format), the
`parsePageCount` function returns `null` because the format is not supported
by the PDF parser. The file is then marked with `status='needs_review'` and
`pricePaise=0` (the default).

The PATCH endpoint (`/api/v1/orders/:id/files/:fileId`) rejects files with
`status='needs_review'` — the customer cannot configure print settings.
No shopkeeper endpoint existed to set the page count manually.

Result: the file stays at ₹0.00 forever, and checkout is blocked.

## Fix Summary

### 1. DOCX page count extraction (parse-page-count.ts)
- Added DOCX support via JSZip: reads `docProps/app.xml` → extracts `<Pages>` element
- Added PPTX support: counts `<p:sldId>` entries in `ppt/presentation.xml`
- Added XLSX support: counts `<sheet>` entries in `xl/workbook.xml`
- Legacy `.doc`/`.ppt`/`.xls` still return `null` (binary formats need rendering)
- Images return 1 page
- PDFs use pdf-lib (unchanged)

### 2. Shopkeeper page-count endpoint
- New route: `POST /api/v1/shops/me/orders/:id/files/:fileId/page-count`
- Owner/staff authorization required
- Tenant isolation: file must belong to shopkeeper's shop
- Only works on files with `status='needs_review'`
- After setting page count: auto-prices the file + recalculates order total
- Transitions file from `needs_review` → `pending`
- Audit log records: who, when, previous value, new value, price

### 3. Checkout validation
- Files with `status='needs_review'` are explicitly rejected at checkout
- Error message explains the shopkeeper must set the page count
- Files with `pricePaise === 0` are rejected (not configured)
- Prevents accidental ₹0.00 checkout

## Processing States

| State | Meaning | Recovery |
|---|---|---|
| `pending` | Uploaded, page count available, awaiting configuration | Customer sets print settings |
| `needs_review` | Page count could not be auto-extracted | Shopkeeper sets page count via API |
| `queued` | Configured and priced, awaiting print | Auto-transition after checkout |
| `printing` | Being printed | PrintEXE agent processing |
| `completed` | Print finished | Terminal |
| `failed` | Print failed | Retry or manual intervention |

## Supported File Formats

| Format | MIME Type | Page Count Method | Accuracy |
|---|---|---|---|
| PDF | `application/pdf` | pdf-lib `getPageCount()` | Exact |
| DOCX | `application/vnd.openxmlformats...wordprocessingml.document` | JSZip + app.xml `<Pages>` | Application-reported (may vary by printer) |
| PPTX | `application/vnd.openxmlformats...presentationml.presentation` | JSZip + slide count | Exact (slide count) |
| XLSX | `application/vnd.openxmlformats...spreadsheetml.sheet` | JSZip + sheet count | Exact (sheet count) |
| JPEG/PNG/GIF/WebP/BMP/TIFF | `image/*` | Fixed: 1 page | Exact |
| DOC | `application/msword` | Not supported → needs_review | Shopkeeper must set manually |
| RTF/TXT/CSV | `text/*` | Not supported → needs_review | Shopkeeper must set manually |

## Pricing Formula

```
billablePages = selectedPages (from pageRange or all pages)
totalPages = billablePages × copies
baseRate = shopConfig[`${colorMode}_${paperSize}_per_page`]
grossPaise = baseRate × totalPages
duplexSaving = duplex ? grossPaise × (duplex_discount / 100) : 0
bulkSaving = totalPages >= bulk_threshold ? (grossPaise - duplexSaving) × (bulk_discount_pct / 100) : 0
subtotal = grossPaise - duplexSaving - bulkSaving
totalPaise = max(subtotal, min_order_value)
```

All calculations use integer paise. No floating-point arithmetic.

## API Contracts

### Upload + confirm
`POST /api/v1/orders/:id/files` — confirms upload, auto-extracts page count

### Configure print settings
`PATCH /api/v1/orders/:id/files/:fileId` — sets copies, color, paper, duplex, pageRange
- Rejected if `status='needs_review'`

### Shopkeeper set page count
`POST /api/v1/shops/me/orders/:id/files/:fileId/page-count`
- Body: `{ pageCount: number }`
- Auto-prices the file + updates order total
- Transitions `needs_review` → `pending`

### Checkout
`POST /api/v1/orders/:id/checkout`
- Rejects files with `status='needs_review'`
- Rejects files with `pricePaise === 0`
- Uses `order.totalAmountPaise` (server-authoritative)

## Limitations

1. DOCX page count from `<Pages>` is application-reported, not rendered.
   It may differ from the actual printed page count on a different printer.
2. Legacy `.doc`/`.ppt`/`.xls` formats require shopkeeper manual review.
3. The shopkeeper page-count endpoint requires the shopkeeper to know the
   actual page count (e.g., by opening the document in Word).

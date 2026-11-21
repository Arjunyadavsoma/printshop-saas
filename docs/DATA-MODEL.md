# PrintShop — Final data model (Phase 0)

Existing models are KEPT; additions are backward-compatible (additive
columns, new tables). The device/companion contract reads PrintJob — so
the brief's PrintTask is implemented **on the existing PrintJob table**
(extended with additive columns), never as a competing table.

## Reconciliation decisions

| Brief concept | Decision | Reason |
|---|---|---|
| `PrintTask` | **Extend `PrintJob`** with: `printerId?`, `kind (color_set|bw_set|full)`, `sourcePages Json` (int[]), `taskPdfStorageKey?`, `sheetCount?`, `colorMode`, `paperSize`, `duplex`, `pagesPerSheet`, `orientation`, `scale`, `setLabel?`, `idempotencyKey @unique`, `dispatchedAt?`, `printedAt?`, `status` values extended (`uncertain`, `spooled`, `received`, `printing`) | The device pending/claim/received routes are PrintJob-shaped; a second table would fork the contract |
| `PrintSpec` | New `PrintSpec` table, 1:1 with PrintFile (`orderFileId @unique`) | PrintFile keeps its legacy flat columns for the existing flow |
| `Payment` (direct UPI + counter) | New `Payment` table; existing `PaymentAttempt`/`PaymentEvent` (PhonePe PSP) untouched | Two different flows: gateway vs direct-UPI/counter |
| `ShopMember` | Existing `User` table gains `role` value `operator` (owner exists); name + lastLoginAt columns added | Same capability, no duplication |
| `PriceRule`/`Addon` | New tables; legacy `Shop.pricingConfig` JSON remains as fallback when no rules exist | Brief wants slabs in tables + history in AuditLog |
| `Order.pickupCode` | New column + `priceSnapshot`, `subtotalPaise`, `addonsPaise`, `placedAt/readyAt/collectedAt/cancelledAt/cancelReason`, `urgent`, `expiresAt`, `paymentMode` (per-order snapshot of shop mode), `orderNumber` | `tokenNumber` stays as the display token |

## New tables

```
Printer        id, shopId, agentId?, systemName, displayName, supportsColor,
               supportsDuplex, paperSizes Json[], isDefaultColor, isDefaultBw,
               status (online|offline|paused|error), statusDetail?, speedPpm?,
               pagesPrintedToday, counterDate, lastSeenAt?, enabled
               @@unique([shopId, systemName])

PrintSpec      id, orderFileId @unique, copies, paperSize, paperType,
               orientation (auto|portrait|landscape), sides (single|double),
               duplexEdge (long|short), pagesPerSheet (1|2|4|6|9),
               scale (fit|actual), collate, pageRangeText?, pageModes Json
               ( [{page,mode:color|bw|skip}] — source of truth )

PriceRule      id, shopId, paperSize, paperType (plain|bond|glossy|photo),
               colorMode (bw|color), sides (single|double),
               slabs Json ([{minPages, perPagePaise}]), active,
               effectiveFrom, createdAt   @@index([shopId, active])

Addon          id, shopId, kind (staple|spiral_bind|laminate|urgent|
               home_delivery_note), label, pricePaise,
               pricingUnit (per_order|per_copy|per_sheet), active

Payment        id, orderId, method (upi|counter_cash|counter_upi),
               status (pending|submitted|confirmed|rejected|refunded_note),
               amountPaise, upiIntentUrl?, utr?, screenshotStorageKey?,
               confirmedBy?, confirmedAt?, rejectReason?, createdAt

OrderEvent     id, orderId, type, actorType (customer|shop|system|agent),
               actorId?, data Json, createdAt   @@index([orderId, createdAt])
               (append-only — no updates, no deletes)

Notification   id, shopId, kind, orderId?, readAt?, payload Json, createdAt

AuditLog       exists — reused for pricing/settings/security changes
```

## Shop — additive columns

`upiPayeeName`, `isOpen Bool @default(true)`, `acceptingOrders Bool`,
`openingHours Json?`, `languages Json @default(["en"])`,
`retentionHours Int @default(24)`,
`paymentMode String @default("UPI_THEN_PRINT")`
(`UPI_THEN_PRINT|PRINT_THEN_PAY|BOTH` — supersedes `paymentMethods`,
which stays untouched for the legacy flow),
`autoConfirmCounterPayment Bool @default(false)`,
`colorSheetBilling String @default("PER_PAGE_ACTUAL")`
(`PER_PAGE_ACTUAL|SHEET_AS_COLOR`),
`orderExpiryMinutes Int @default(30)`, `urgencySurchargePaise Int @default(0)`,
`plan String @default("starter")`, `queueMinutesPerPageBw/color Int` (wait
estimator), `scheduledOrders Bool @default(false)`.

## User — additive columns
`name String?`, `lastLoginAt DateTime?`; role gains `operator`
(server-side guards: operator cannot write PriceRule/Addon/Shop UPI/staff
or delete).

## Order — additive columns
`orderNumber String? @@unique([shopId, orderNumber])`, `pickupCode String?`,
`subtotalPaise Int @default(0)`, `addonsPaise Int @default(0)`,
`priceSnapshot Json?`, `placedAt/readyAt/collectedAt/cancelledAt DateTime?`,
`cancelReason?`, `urgent Bool @default(false)`, `expiresAt DateTime?`,
`paymentModeAtOrder String?`, `scheduledFor DateTime?`.
`status` values extended: `draft, awaiting_payment, payment_submitted, paid,
queued, printing, partially_printed, ready, collected, paid_on_pickup,
cancelled, failed, expired`.

## PrintFile — additive columns
`pdfStorageKey?`, `pageWidthPt Float?`, `pageHeightPt Float?`,
`failReason?`, `checksum?`, `colorSuggestion Json?`
(`[{page,isColor,confidence}]`), `status` values: `uploaded, converting,
ready, failed`.

## Migrations
1. `20261121000000_product_phase1` — all additive columns + new tables
   above (one migration; additive only, no rewrites, no data loss).
2. Seed (bun run db:seed): 2 shops (slug `sai-xerox`, `ganesh-digital`),
   3 printers each (one color-capable, one BW-only, one paused-error),
   PriceRules per paper size × color × sides with 2-slab tiers, 4 add-ons,
   15 sample orders per shop spread across every status, one owner +
   one operator account per shop, 1-color-in-10 mixed sample PDF.

## Status machines (server-enforced)
Order: `draft → awaiting_payment → payment_submitted → paid → queued →
printing → partially_printed → ready → collected`; exits `cancelled`
(before printing) / `failed` / `expired` (unpaid, 30 min default);
PRINT_THEN_PAY shops: `draft → queued → … → ready → paid_on_pickup →
collected`. READY only when all tasks PRINTED. Task (PrintJob.status):
`queued → dispatched → received → printing → spooled → printed`, exits
`uncertain / failed / cancelled`; retries ⇒ `attempts+1`; UNCERTAIN never
auto-retried. Every transition writes an OrderEvent row.

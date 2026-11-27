# PRINTELYX — Consumer Pipeline Map

**Date:** 2026-11-27

The complete 22-step customer journey, mapped to actual frontend routes, API requests, server handlers, database models, and state transitions.

---

## Step 1: Open Printelyx

| Aspect | Detail |
|---|---|
| Route | `/` (`src/app/page.tsx`) |
| API | `GET /api/shops/nearby` (if location) or `GET /api/v1/shops?limit=50` |
| Auth | None (public) |
| State | Initial load |
| Failure | API 500 → error banner; empty → empty state |
| Recovery | Retry button |

## Step 2: Discover nearby shops

| Aspect | Detail |
|---|---|
| Route | `/find-a-shop` (`src/app/find-a-shop/page.tsx`) |
| API | `GET /api/shops/nearby?lat=&lng=&radius=&search=&openNow=&service=&sort=&page=&limit=` |
| Handler | `src/app/api/shops/nearby/route.ts` → `getContainer().db.findMany('shop', { isActive: true })` |
| Models | `Shop` (name, slug, address, lat/lng, openingHours, servicesJson, pricingConfig) |
| State | Loading → shops list |
| Failure | Location denied → manual search fallback; API 500 → error state |
| Recovery | "Detect my location" button or text search |

## Step 3: Search and filter shops

| Aspect | Detail |
|---|---|
| Route | `/find-a-shop` (same page, client-side filter) |
| API | Same nearby API with query params |
| Filters | `openNow`, `service` (bw_print, color_print, scan, laminate, binding), `sort` (nearest, name) |
| State | Filtered list |
| Failure | No results → empty state with "Try different filters" |

## Step 4: Open shop profile

| Aspect | Detail |
|---|---|
| Route | `/s/[shopSlug]` (`src/app/s/[shopSlug]/page.tsx`) |
| API | `GET /api/v1/shops?limit=50` (filtered by slug client-side) |
| Models | `Shop` (full profile) |
| State | Shop details displayed |
| Failure | Shop not found → 404 |

## Step 5: Inspect services and prices

| Aspect | Detail |
|---|---|
| Route | `/s/[shopSlug]` (same page) |
| Data | `Shop.servicesJson`, `Shop.pricingConfig`, `PriceRule` (via API) |
| State | Services + pricing summary visible |
| Failure | No pricing rules → "Estimated pricing" warning |

## Step 6: Start a print order

| Aspect | Detail |
|---|---|
| Route | `/s/[shopSlug]` → "Start Printing" button → Smart Print Studio mounts |
| Component | `SmartPrintStudioLazy.tsx` → `SmartPrintStudio.tsx` |
| API | `POST /api/v1/s/[slug]/uploads/init` (creates draft order + upload session) |
| Models | `Order` (status: 'draft'), `UploadSession` |
| State | Step: 'upload' |
| Idempotency | Order ID from upload init; reused throughout |

## Step 7: Upload documents

| Aspect | Detail |
|---|---|
| Component | `StepUpload.tsx` → `startUpload` + `uploadChunk` + `completeUpload` |
| API | `POST /uploads/init`, `PUT /uploads/chunk` (2MB + SHA-256), `POST /uploads/complete` |
| Models | `UploadSession`, `UploadChunk`, `PrintFile` |
| State | File status: queued → uploading → uploaded → converting → ready |
| Failure | Chunk failure → retry with backoff (1s→2s→4s→8s) |
| Recovery | `GET /uploads/status?uploadId=` returns missing chunks for resume |

## Step 8: Process and validate files

| Aspect | Detail |
|---|---|
| API | `GET /api/v1/s/[slug]/files/[fileId]?token=` (poll for pageCount, thumbnails, colorSuggestion) |
| Server | File pipeline: PDF → page count → thumbnails → color detection |
| Models | `PrintFile` (pageCount, pageCountSource, thumbnails, colorSuggestion, sha256) |
| State | Polling until `status === 'ready'` |
| Failure | Processing error → `status: 'failed'` with error message |

## Step 9: Configure print settings

| Aspect | Detail |
|---|---|
| Component | `StepPrintSettings.tsx` |
| API | `PUT /api/v1/s/[slug]/specs` (saves PrintSpec per file) |
| Models | `PrintSpec` (pageModes, copies, sides, paperSize, paperType, collate) |
| State | Step: 'settings' |
| Validation | Page ranges validated against pageCount; no overlap; no duplicates |

## Step 10: Preview documents

| Aspect | Detail |
|---|---|
| Component | `StepPreview.tsx` (shows thumbnails, page ranges, settings) |
| State | Step: 'preview' |

## Step 11: Obtain authoritative quote

| Aspect | Detail |
|---|---|
| API | `POST /api/v1/s/[slug]/quote` (stateless, server-side) |
| Handler | `quoteOrder()` in `order-flow.ts` → `planPrintJob()` + `computeOrderPrice()` |
| Models | `PriceRule` (slabs), `Addon` |
| Response | `{ lines, subtotalPaise, addonsPaise, urgentPaise, totalPaise, ruleMissing, warnings }` |
| State | Quote stored in React state; debounced refresh on settings change (600ms) |
| Failure | `ruleMissing` → warning banner; `totalPaise === null` → cannot proceed |

## Step 12: Review complete order

| Aspect | Detail |
|---|---|
| Component | `StepPreview.tsx` (shows itemized breakdown + customer details) |
| State | Step: 'preview' with quote loaded |
| Validation | `canProceed = quoteReady && phoneValid` |

## Step 13: Create pending checkout/order

| Aspect | Detail |
|---|---|
| Trigger | `onProceed` → `placeTheOrder()` (commit `e4fd899` — the checkout fix) |
| API | `PUT /specs` (per file), `POST /api/v1/s/[slug]/orders` |
| Handler | `placeOrder()` in `order-flow.ts` |
| Models | `Order` → status: 'awaiting_payment', totalAmountPaise, priceSnapshot, orderNumber, pickupCode, expiresAt |
| State transitions | `draft → awaiting_payment` (UPI shops) or `draft → queued` (counter shops) |
| Idempotency | `placing` state guard (client) + `placeOrder` returns existing orderNumber if already placed (commit `cd6f4b3`) |
| Auth | Optional customer JWT (role: 'customer') links order to CustomerAccount |
| Failure | 409 PRICES_CHANGED → error banner with new total; 400 → validation error |
| Recovery | Customer reviews new total and clicks Proceed again |

## Step 14: Start payment

| Aspect | Detail |
|---|---|
| Component | `StepPayment.tsx` (shows UPI/counter options + UTR input) |
| API | `POST /api/v1/o/[token]/payment` (UTR submission) |
| Handler | `submitPayment()` in `order-flow.ts` |
| Models | `Payment` (method, status: 'SUBMITTED'/'PENDING', utr, amountPaise) |
| State transitions | `awaiting_payment → payment_submitted` |
| Idempotency | `submitPayment` returns existing active Payment (Feature 4 W1) |
| Validation | UTR: 12 digits; declaredAmountPaise: required, must match order total; expiresAt: must not be expired |
| Failure | Amount mismatch → 400; expired → 400; invalid UTR → 400 |
| ToroPay path | If shop uses ToroPay: `POST /api/v1/orders/[id]/checkout` creates PaymentAttempt + ToroPay checkout URL |

## Step 15: Complete or abandon payment

| Aspect | Detail |
|---|---|
| Direct UPI | Customer pays shop's UPI ID → enters UTR → submits |
| ToroPay direct UPI | Customer pays via ToroPay payment link → `payment.paid` webhook → pending merchant verification |
| ToroPay provider checkout | Customer pays on hosted checkout → `payment.confirmed` webhook → auto-finalized |
| Abandon | Customer closes browser → order stays in `payment_submitted` → `expiresAt` (30 min) → `expired` |

## Step 16: Verify payment

| Aspect | Detail |
|---|---|
| Direct UPI | Shopkeeper calls `POST /api/v1/shops/me/orders/[id]/confirm-payment` → `confirmPayment()` → `paid` |
| ToroPay provider checkout | Webhook `payment.confirmed` → `applyPaymentTransition()` → `paid` (atomic) |
| Reconciliation | `GET /api/v1/cron/reconcile-payments` polls stale attempts via `adapter.verifyPayment()` |
| State transitions | `payment_submitted → paid → queued` |
| Security | Never marked paid from frontend/redirect/query param |

## Step 17: Finalize order

| Aspect | Detail |
|---|---|
| Handler | `confirmPayment()` → `buildTasksForOrder()` (creates PrintJob rows) |
| Models | `Order` (status: 'queued'), `PrintJob` (idempotencyKey @unique) |
| State transitions | `paid → queued` |
| Atomicity | `applyPaymentTransition()` in single db.$transaction |
| Recovery | If finalization fails after payment: reconciliation cron re-tries |

## Step 18: Show confirmation

| Aspect | Detail |
|---|---|
| Component | `StepConfirmation.tsx` (5 states: submitted/confirmed/rejected/cancelled/unknown) |
| API | `GET /api/v1/o/[token]` (refresh status) |
| State | `paymentStatus` mapped from order.status + payment.status |
| Navigation | "Track your order" → `/o/[token]`; "Continue browsing" → `/find-a-shop` |

## Step 19: Track order

| Aspect | Detail |
|---|---|
| Route | `/o/[token]` (`src/app/o/[token]/page.tsx`) |
| API | `GET /api/v1/o/[token]` (token-gated, 128-bit, anti-enumeration) |
| Realtime | Socket.IO room `order:<token>` |
| Polling | Visibility-aware exponential backoff (5s→10s→30s→60s) |
| Timeline | Placed → Payment → Printing → Ready → Collected |
| State | Live status updates |

## Step 20: Receive notifications

| Aspect | Detail |
|---|---|
| Shopkeeper | `Notification` model: `new_order`, `payment_submitted`, `payment_confirmed`, `order_ready` |
| Customer | In-app via tracking page (poll + realtime); no email/push yet |
| Dedup | Application-layer (no DB unique constraint yet) |

## Step 21: View order history

| Aspect | Detail |
|---|---|
| Route | `/orders` (`src/app/orders/page.tsx`) |
| Data | localStorage `printshop:recent-orders` (capped 20, no PII) |
| State | List of past orders with status badges + "Track" action |

## Step 22: Reorder

| Aspect | Detail |
|---|---|
| Status | Not implemented — would require re-using the same shop + specs |
| Limitation | Documented as a future enhancement |

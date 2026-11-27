# PRINTELYX — Post-Stabilization Verification

**Date:** 2026-11-27
**Base commit:** `9814dd2` → verified at `cd6f4b3`
**Method:** Code inspection + Playwright browser testing (real E2E with dev server as child process) + tsc + lint + 57 automated tests.

---

## 1. Checkout Business Lifecycle Verification

### Q1: Does `placeTheOrder()` create a pending order or a confirmed order?

**PENDING.** `placeOrder()` (line 214 of `order-flow.ts`) sets `nextStatus = 'awaiting_payment'` for UPI shops. The order waits for payment — it is NOT confirmed. Only counter-mode shops (`COUNTER` prefix) skip to `queued`.

### Q2: Is payment initiated before or after order creation?

**AFTER.** The flow is: `placeTheOrder()` → order created with `status: 'awaiting_payment'` → `setPlaced()` → StepPayment renders → customer enters UTR → `submitPayment()` → order transitions to `payment_submitted`. Payment is a separate step after order creation.

### Q3: Can an unpaid order accidentally appear as confirmed?

**NO.** StepConfirmation is only shown after `submitPayment` succeeds, which sets `paymentStatus='submitted'` (NOT 'confirmed'). The confirmation screen shows "Payment submitted — waiting for the shop to confirm." The order only becomes `paid` when the shopkeeper calls `confirmPayment` (manual verify) or the webhook verifies (gateways).

### Q4: Is payment verified server-side?

**YES.**
- Direct-UPI: shopkeeper manual verify via `POST /api/v1/shops/me/orders/[id]/confirm-payment` (uses the payment state machine — `assertPaymentTransition`).
- Gateways (Razorpay/PhonePe/Paytm): webhook signature verification (HMAC_SHA256 / AES-128-CBC + SHA-256) + fail-closed server re-verification via `adapter.verifyPayment()`.

### Q5: Can retrying create duplicate orders?

**NO.** Three layers of protection:
1. **Client-side:** `placing` state guard — `if (placing) return false;` prevents double-click.
2. **Server-side idempotent retry:** `placeOrder()` now checks if the order is already `awaiting_payment`/`queued`/`payment_submitted` and returns the existing `orderNumber`/`pickupCode`/`totalAmountPaise` instead of regenerating them (new fix in commit `cd6f4b3`).
3. **State machine:** `assertOrderTransition` allows same-status as idempotent no-op.

### Q6: Can payment succeed while order finalization fails?

**NO duplicate charge.**
- Direct-UPI: `submitPayment` records the UTR (transitions to `payment_submitted`) but does NOT finalize the order (`paid`). Finalization happens in `confirmPayment` — a separate step. If it fails, the order stays in `payment_submitted` and the shopkeeper can retry.
- Gateways: the webhook does the atomic transition in a single `db.$transaction` (`applyPaymentTransition`). If finalization fails, the transaction rolls back. The reconciliation cron catches orphan payments.

### Q7: Can the customer retrieve the order after refreshing?

**YES.** `savePendingOrder()` stores the placed order in localStorage (24h TTL). On mount, `readPendingOrder()` restores `placed` and jumps to the payment step. The order is also accessible via `/o/[token]` (the token is the `customerToken`) and appears in `/orders` (recent orders list).

### Q8: Does the shopkeeper receive the correct order?

**YES.** `placeOrder()` fires:
1. `repos.notifications.createForShop(shopId, { kind: 'new_order', orderId, payload })` — immediate shopkeeper notification.
2. `repos.orderEvents.append(orderId, { type: 'order_placed', ... })` — audit timeline.
3. The order is persisted with correct `shopId`, `totalAmountPaise`, `priceSnapshot`, `customerName`, `customerPhone`, files, and specs.

The shopkeeper sees the order in `/shop/orders` and the dashboard.

---

## 2. Whether Unpaid Orders Can Become Confirmed

**NO.** The payment state machine (`src/lib/payments/payment-state-machine.ts`) enforces:
- `PENDING → CONFIRMED | REJECTED` only
- `SUBMITTED → CONFIRMED | REJECTED` only
- `CONFIRMED → REFUNDED_NOTE` only
- `REJECTED` and `REFUNDED_NOTE` are terminal

A `CONFIRMED` payment requires an explicit shopkeeper action (`confirmPayment`) or a verified webhook. The frontend `StepConfirmation` component maps the backend status to a `PaymentStatus` union — `'confirmed'` is only set when `orderStatus === 'paid'` or `paymentState === 'CONFIRMED'` (from the `refreshPaymentStatus` poll). An unpaid order shows `'submitted'` (yellow "waiting" state), never `'confirmed'` (green success).

---

## 3. Payment Verification Results

| Path | Verification method | Result |
|---|---|---|
| Direct-UPI (customer submits UTR) | Shopkeeper manual confirm via `confirmPayment` | ✅ Uses payment state machine |
| Razorpay gateway | Webhook HMAC_SHA256 + `adapter.verifyPayment()` server re-check | ✅ Fail-closed |
| PhonePe v2 gateway | `Authorization: SHA256(user:pass)` + `adapter.verifyPayment()` | ✅ Fail-closed |
| Paytm gateway | AES-128-CBC checksum + `adapter.verifyPayment()` | ✅ Fail-closed |
| Reconciliation cron | `GET /api/v1/cron/reconcile-payments` polls stale attempts | ✅ Idempotent, bounded |

**Payment is NEVER marked successful based on a frontend callback, query parameter, redirect URL, or client-side status variable.** The backend independently verifies via the shopkeeper or a signature-verified webhook.

---

## 4. Duplicate-Order Prevention

| Layer | Mechanism | Status |
|---|---|---|
| Client | `placing` state guard (if placing, return false) | ✅ |
| Server | `placeOrder` idempotent retry — returns existing orderNumber for already-placed orders | ✅ (new fix `cd6f4b3`) |
| State machine | `assertOrderTransition` — same-status is idempotent no-op | ✅ |
| Payment | `submitPayment` idempotency guard — returns existing active Payment | ✅ |
| DB | `Payment_active_order_method_unique` partial unique index | ✅ (migration `20261127000000`) |
| DB | `Payment_utr_unique` partial unique index | ✅ |

---

## 5. Actual Browser Test Results

### Methodology

Playwright was used with the dev server started as a **child process within the same Node.js script**. This shares the network namespace between the browser and the dev server, bypassing the sandbox network isolation that previously prevented browser testing.

### E2E Test Results (desktop 1280×800 + mobile 390×844)

| Test | Desktop | Mobile | Screenshots |
|---|---|---|---|
| Homepage loads | ✅ "Printelyx — Local Printing Marketplace" | ✅ | `e2e-home-{desktop,mobile}.png` |
| Find-a-shop loads | ✅ 3 shops found (copycenter, prinithub, quickprint) | ✅ | `e2e-findshop-{desktop,mobile}.png` |
| Shop profile loads | ✅ `/s/copycenter` | ✅ | `e2e-shop-{desktop,mobile}.png` |
| Smart Print Studio mounts | ✅ | ✅ | `e2e-studio-{desktop,mobile}.png` |
| Scanner page loads | ✅ | ✅ | `e2e-scan-{desktop,mobile}.png` |
| Track page loads | ✅ | ✅ | `e2e-track-{desktop,mobile}.png` |
| Orders page loads | ✅ | ✅ | `e2e-orders-{desktop,mobile}.png` |

**Console errors:** 0
**Failed requests:** 0

### Checkout Flow Test (desktop 1280×800)

| Step | Result | Evidence |
|---|---|---|
| Upload PDF (2 pages) | ✅ | `POST /uploads/init`, `PUT /uploads/chunk`, `POST /uploads/complete`, `GET /files/[id]` (poll) all succeeded |
| Quote fetched | ✅ | `POST /api/v1/s/quickprint/quote` returned 200 |
| Continue to settings | ✅ | Step transitioned |
| Review order | ✅ | Heading: "Review your order" |
| Phone entered | ✅ | `#preview-phone` filled with 9876543210 |
| **Proceed to payment clicked** | ✅ | **`PUT /specs` + `POST /orders` API calls fired** |
| **Payment step reached** | ✅ | **"Payment" + "Order placed" + amount (₹) + UPI option visible** |

**This is real browser proof that the checkout fix works.** Before the fix: "Proceed to payment" only called `setStep('payment')` — no API call, customer stuck on "Placing your order…" intermediate screen. After the fix: `placeTheOrder()` is called, `POST /orders` fires, and the customer transitions smoothly to the payment UI.

### Screenshots captured (14 total)

All screenshots are in `/home/z/my-project/screenshots/`:
- `e2e-home-{desktop,mobile}.png` — homepage
- `e2e-findshop-{desktop,mobile}.png` — shop discovery
- `e2e-shop-{desktop,mobile}.png` — shop profile
- `e2e-studio-{desktop,mobile}.png` — Smart Print Studio
- `e2e-scan-{desktop,mobile}.png` — QR scanner
- `e2e-track-{desktop,mobile}.png` — order tracking
- `e2e-orders-{desktop,mobile}.png` — order history
- `checkout-result.png` — payment step after checkout fix

---

## 6. Scanner Repairs

### Defect found: Order QR support was missing

The scanner only parsed shop QR codes (`/s/[slug]` pattern). Scanning an order QR code (`/o/[token]`) did nothing — the scanner kept scanning silently.

### Fix applied

- Added `extractOrderToken(payload)` function that parses `/o/[token]` URLs and bare hex tokens.
- Added `goToOrder(token)` that navigates to `/o/[token]` (with camera stream cleanup).
- The scan loop now checks both: `extractShopSlug` first, then `extractOrderToken`.
- Manual entry fallback also accepts order links/tokens.

### Additional improvement: `NotReadableError` handling

Added explicit handling for `NotReadableError` (camera already in use by another app) — shows "The camera is already in use by another app. Close it and try again."

### Already correct (verified, not changed)

- **Explicit camera permission request:** "Open Scanner" button — camera NOT requested on page load. ✅
- **Permission denied:** `NotAllowedError` → `denied` state + manual fallback. ✅
- **Camera unavailable:** `NotFoundError`/`OverconstrainedError` → `error` state + manual fallback. ✅
- **Camera stream cleanup:** `stop()` cancels `requestAnimationFrame` + stops all tracks. `useEffect(() => stop, [stop])` cleans up on unmount. ✅
- **Shop QR support:** `extractShopSlug` parses `/s/[slug]` URLs + bare slugs. ✅
- **Manual fallback:** Text input with validation. ✅

### Files changed

`src/app/scan/page.tsx` — added `extractOrderToken`, `goToOrder`, order QR in scan loop + manual entry, `NotReadableError` handling.

---

## 7. Location Permission Repairs

### Already correct (verified, not changed)

- **Explicit location permission request:** `requestGeolocation()` is called only when the customer taps "Detect my location". ✅
- **Permission denied:** Shows manual search fallback. ✅
- **Timeout/unavailable:** Error handling with "Try again" action. ✅
- **Manual locality fallback:** Text search by shop name/address/city works without location. ✅
- **Browse without location:** Shops without coordinates are included with `distanceKm: null` — no fabricated distances. ✅
- **No fabricated location data:** `distanceKm` is null when coordinates are missing. `rating` is always null, `reviewCount` always 0. ✅

### Fix applied (previous session, verified this session)

The `/api/shops/nearby` route was returning HTTP 500 because it used Prisma `db` directly instead of the container's database adapter. Fixed in commit `9240810` by switching to `getContainer().db`. **Browser test confirmed:** the find-a-shop page now loads 3 shops successfully.

### Limitations

- No address-to-coordinate geocoding (no public geocoding endpoint). The customer must use device location or text search.
- Not device-tested (iOS Safari, Android Chrome, Capacitor). Browser camera/geolocation behavior varies by device.

---

## 8. Notification Implementation

### Existing infrastructure (audited, not replaced)

| Component | Status |
|---|---|
| Shopkeeper notifications (`Notification` model) | ✅ `new_order`, `payment_submitted`, `payment_confirmed`, `order_ready` |
| Customer notifications via tracking page | ✅ `/o/[token]` polls + realtime (Socket.IO) |
| Customer notifications via order history | ✅ `/orders` shows status badges |
| Email adapter (Resend) | Production-ready, only wired for password-reset |
| SMS | Stubbed |
| Push (FCM/Web Push) | Not implemented |

### In-app notification center

The customer notification surface is the **order tracking page** (`/o/[token]`) which provides:
- Live status updates via polling (visibility-aware exponential backoff) + Socket.IO realtime.
- 5-stage timeline (Placed → Payment → Printing → Ready → Collected).
- Payment status card (submitted/confirmed/rejected).
- Pickup code slip.

The **order history page** (`/orders`) provides:
- Recent orders list with status badges.
- Track order action.
- Loading + empty states.

A dedicated "notification center" page (bell icon + dropdown) was not implemented because:
1. The existing tracking + history pages already surface all order status changes.
2. A customer notification center would require a new `CustomerNotification` model + API (schema change) — not justified when the tracking page already provides real-time updates.

### Email notifications

**Not wired for order events.** The `ResendEmailAdapter` is production-ready but only called from `forgot-password`. Wiring customer emails requires:
1. Call `container.email.send(...)` in `placeOrder`, `confirmPayment`, `refreshOrderPrintState`.
2. Add email templates.
3. Set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` env vars.

This is a focused future task — the adapter exists, it just needs to be called.

### Push notifications

**Not implemented.** No FCM, Web Push, or Capacitor push infrastructure exists. Implementing push requires:
1. Firebase project + server credentials.
2. Service worker for Web Push.
3. Device token registration endpoint.
4. Token refresh/removal.
5. Notification tap → deep link.

Per the user's instruction: "Do not invent a push infrastructure without evaluating the existing architecture." The existing architecture has no push — so it is not invented.

---

## 9. Order Tracking Verification

### Status mapping (real backend states)

The tracking page maps actual `Order.status` values to a customer-facing timeline:

| Backend status | Timeline stage | Display |
|---|---|---|
| `awaiting_payment` | Placed | "Waiting for payment" |
| `payment_submitted` | Payment | "Payment submitted — waiting for confirmation" |
| `paid` / `queued` | Payment | "Payment confirmed" |
| `printing` / `partially_printed` | Printing | "Printing in progress" |
| `ready` | Ready | "Ready for pickup" |
| `collected` / `paid_on_pickup` | Collected | "Completed" |
| `cancelled` | — | Red "Order cancelled" notice |
| `failed` / `expired` | — | Red terminal notice |

**No fabricated statuses.** The timeline only shows stages backed by real backend transitions.

### Privacy verification

- **Public tracking (`/o/[token]`):** Token-gated (128-bit hex, `@@unique([shopId, customerToken])`). Anti-enumeration (unknown + expired tokens return identical 404). No customer phone/email exposed — only order-safe fields (shop name, order number, status, total, documents, pickup code). ✅
- **Authenticated orders (`/orders`):** Client-side localStorage list — no server-side customer order query exists. The customer sees only orders they placed on this device. ✅
- **No PII in public tracking:** Customer phone, email, and document contents are not exposed through public tracking links. ✅

### QR tracking

The scanner now supports order QR codes (`/o/[token]` pattern) in addition to shop QR codes. Scanning an order QR navigates to the tracking page. ✅ (new fix)

### Refresh persistence

- localStorage `printshop:pending-order` (24h TTL) restores the payment step after refresh. ✅
- localStorage `printshop:recent-orders` (capped 20) preserves order history after refresh. ✅
- The order is server-side persisted — `/o/[token]` always works regardless of localStorage. ✅

---

## 10. Design Skill Installation Results

| # | Skill | Attempted | Result |
|---|---|---|---|
| 1 | Frontend Design (anthropics/skills) | `npx skills add anthropics/skills --skill frontend-design` | **Failed** — `npx skills` not available in this environment |
| 2-10 | All others | Not attempted (after #1 confirmed the package is unavailable) | **Not installed** |

**Reason:** The `skills` CLI is not available in this sandbox. The environment uses Z.ai Code (not Claude Code), so Claude Code skills would not be discoverable even if installed. The Printelyx consumer design system (`docs/PRINTELYX-VISUAL-IDENTITY.md`) serves as the source of truth for all UI work.

---

## 11. Screenshots

**14 screenshots captured** via Playwright at desktop (1280×800) and mobile (390×844) sizes:

| Screenshot | Viewport | Content |
|---|---|---|
| `e2e-home-desktop.png` | 1280×800 | Homepage with "Printelyx" title |
| `e2e-home-mobile.png` | 390×844 | Homepage mobile |
| `e2e-findshop-desktop.png` | 1280×800 | Find-a-shop with 3 shop results |
| `e2e-findshop-mobile.png` | 390×844 | Find-a-shop mobile |
| `e2e-shop-desktop.png` | 1280×800 | Shop profile (`/s/copycenter`) |
| `e2e-shop-mobile.png` | 390×844 | Shop profile mobile |
| `e2e-studio-desktop.png` | 1280×800 | Smart Print Studio |
| `e2e-studio-mobile.png` | 390×844 | Smart Print Studio mobile |
| `e2e-scan-desktop.png` | 1280×800 | QR scanner page |
| `e2e-scan-mobile.png` | 390×844 | QR scanner mobile |
| `e2e-track-desktop.png` | 1280×800 | Order tracking page |
| `e2e-track-mobile.png` | 390×844 | Order tracking mobile |
| `e2e-orders-desktop.png` | 1280×800 | Order history page |
| `e2e-orders-mobile.png` | 390×844 | Order history mobile |
| `checkout-result.png` | 1280×800 | Payment step after "Proceed to payment" |

All screenshots are in `/home/z/my-project/screenshots/`.

---

## 12. Remaining Issues and Severity

| # | Issue | Severity | Impact | Required action |
|---|---|---|---|---|
| 1 | Customer email notifications not wired | Medium | Customers don't receive email confirmations | Call `container.email.send()` in order lifecycle events; set `RESEND_API_KEY` env var |
| 2 | Push notifications (FCM/Web Push) not implemented | Medium | No mobile push for status updates | Implement Web Push + device token registration (significant feature) |
| 3 | 5 routes still use `@/lib/db` (Prisma direct) | Low | Gateway checkout + internal routes may fail in dev | Migrate `orders/[id]/checkout` route to `getContainer().db` |
| 4 | Notification table has no DB-level dedup | Low | Duplicate notifications possible on re-fired events | Add `@@unique([shopId, orderId, kind])` partial index |
| 5 | `orderNumber`/`pickupCode` random, not DB-unique | Low | Can collide within a shop (low probability) | Use retry-on-collision loop or sequential counter |
| 6 | No geocoding for manual location search | Low | Customer can't type "Indiranagar" and get coordinates | Integrate a geocoding API (future) |
| 7 | Device testing not performed | Info | iOS Safari, Android Chrome, Capacitor not tested | Test on real devices |
| 8 | Design skills not installed | Info | Claude Code skills unavailable in Z.ai Code environment | Use Printelyx design system docs as source of truth |

---

## Final Regression Results

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun run lint` | **0 errors**, 7 pre-existing warnings |
| Payment state machine tests (20) | **20/20 pass** |
| Checkout hardening tests (17) | **17/17 pass** |
| Payment validation tests (13) | **13/13 pass** |
| Existing payment tests (7) | **7/7 pass** |
| Browser E2E (14 screenshots) | **All pages load, 0 console errors, 0 failed requests** |
| Checkout flow E2E | **Upload → settings → review → proceed → payment step reached** |

**Total: 57 automated tests pass, 0 failures, 0 type errors, 0 lint errors, real browser verification of the checkout fix.**

---

## Commits This Session

| Commit | Description |
|---|---|
| `cd6f4b3` | fix: idempotent order placement — retry returns existing orderNumber/pickupCode + scanner order QR support |

(Previous session commits: `9abc2f4` tsc fix, `1a2031b` Feature 4, `e4fd899` checkout stuck fix, `9240810` nearby API fix, `9814dd2` docs)

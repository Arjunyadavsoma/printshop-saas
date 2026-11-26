# PRINTELYX — Checkout & Payments Architecture Audit

**Feature 4 — Phase 0 mandatory audit.**
**Audited by:** 4 parallel read-only exploration agents (P0-A schema, P0-B APIs/providers, P0-C Studio/pricing, P0-D notifications/dashboards/env).
**Date:** 2026-11-26
**Repo:** `Arjunyadavsoma/printshop-saas` @ `9abc2f4`

> **Headline finding:** The existing payment architecture is substantially more mature than a typical early-stage product. Razorpay, PhonePe (v1 + v2), Paytm, and direct-UPI are all genuinely implemented with real cryptographic signature verification, fail-closed server re-verification, and atomic PostgreSQL lifecycle transitions. The work required is **hardening and gap-closing**, not a rebuild. A second pricing engine, duplicate payment APIs, or a replaced webhook pipeline would be actively harmful.

---

## 1. Existing Payment Architecture

### 1.1 Three parallel payment state stores (the central design smell)

Payment state is duplicated across three stores with no reconciliation constraint:

| Store | Purpose | Scope |
|---|---|---|
| **`Order`** (inline fields) | Legacy: `paymentProvider`, `paymentTxnId @unique`, `paymentUtr`, `paidAt`, `paymentModeAtOrder`, `status` | One provider txn id per order max |
| **`PaymentAttempt`** + **`PaymentEvent`** | Gateway flow (Razorpay/PhonePe/Paytm). One attempt = one `merchantOrderId @unique`. Multiple attempts per order supported via partial unique `(orderId) WHERE status='created'` | Authoritative for webhook-driven flows |
| **`Payment`** | Direct-UPI + counter-cash flow. `method`, `utr`, `screenshotStorageKey`, `confirmedBy`, `confirmedAt`, `rejectReason`. Multiple rows per order | Authoritative for manual UTR / counter |

There is **no `Transaction` model** and **no `Refund` model**. Provider transaction IDs appear in four places (`Order.paymentTxnId`, `PaymentAttempt.providerTransactionId`, `WebhookInbox.providerTxnId`, `PaymentEvent.providerTransactionId`). UTR is duplicated (`Order.paymentUtr` + `Payment.utr`).

### 1.2 Payment models that exist

| Model | File | Role |
|---|---|---|
| `Order` | `prisma/schema.prisma:183` | Order + inline payment fields + `priceSnapshot` + `expiresAt` |
| `PaymentAttempt` | `prisma/schema.prisma:455` | Per-gateway attempt with `merchantOrderId @unique`, `providerTransactionId`, `idempotencyKey?`, `expiresAt` |
| `PaymentEvent` | `prisma/schema.prisma:489` | Append-only audit log per attempt. `@@unique([provider, eventId])` (but `eventId` nullable — dedup escape) |
| `WebhookInbox` | `prisma/schema.prisma:520` | Durable buffer for unmatched webhooks (arrive before attempt exists) |
| `Payment` | `prisma/schema.prisma:738` | Direct-UPI / counter-cash records. `method`, `utr`, `screenshotStorageKey`, `confirmedBy` |
| `OrderEvent` | `prisma/schema.prisma:758` | Coarse append-only order timeline (`type`, `actorType`, `actorId`, `data`) |
| `AuditLog` | `prisma/schema.prisma:433` | Per-shop/user action audit |
| `Notification` | `prisma/schema.prisma:773` | Shopkeeper-facing notifications (`kind`, `orderId?`, `payload`, `readAt`) |

### 1.3 Payment models that DO NOT exist

- **`Refund`** — no model, no fields, no route. `Payment.status='REFUNDED_NOTE'` is a string annotation; `OrderStatus='refunded'` is declared in one TS union but has no state-machine transition and is never written.
- **`Transaction`** — not a model. `prisma.$transaction` is the only meaning of "transaction".
- **Prisma `enum`s** — there are **zero** `enum` declarations. Every status/provider/method column is a plain `String` with a comment. No DB CHECK constraints. Two TS `OrderStatus` unions disagree (`packages/core/src/domain/enums.ts` vs `src/lib/orders/state-machine.ts`).

---

## 2. Working Integrations (genuinely implemented)

### 2.1 Direct-UPI (primary customer flow)

**Status: IMPLEMENTED — manual verification by design.**

- `src/lib/payments/upi.ts`: `buildUpiIntentUrl({payeeUpi, payeeName, amountPaise, orderShortId})`, `isValidUpiId`, `isValidUtr` (strict `/^\d{12}$/`), `PaymentVerifier` interface (`MANUAL` default, `AUTO` pluggable but unwired).
- Customer pays the shop's own VPA directly via `upi://pay?...` deep link.
- Customer submits 12-digit UTR via `POST /api/v1/o/[token]/payment`.
- **The platform never claims the payment is verified.** The shopkeeper manually confirms/rejects via `POST /api/v1/shops/me/orders/[id]/confirm-payment`.
- Duplicate-UTR-per-shop fraud guard implemented (application-layer, O(N) queries, raceable — see §5).

### 2.2 Razorpay

**Status: FULLY IMPLEMENTED (no SDK — raw `fetch`).**

- `packages/adapters/src/payment/razorpay.adapter.ts` (231 lines): `createPaymentIntent` (POST `/v1/orders`), `verifyPayment` (GET `/orders/{id}/payments`), `handleWebhook` (HMAC_SHA256 + `timingSafeEqual`), `refund` (POST `/payments/{id}/refund`).
- HTTP Basic auth with per-shop `keyId`/`keySecret` (encrypted at rest in `Shop.paymentCredentials` via AES-256-GCM).
- Routes: `POST /api/v1/payments/razorpay/webhook` + `POST /api/v1/payments/razorpay/verify` (Checkout.js success).
- **Fail-closed server re-verification (PAY-003):** after signature verify, calls `adapter.verifyPayment()` against Razorpay's server before transitioning.
- Idempotency: cache `pay:done:razorpay:${txnId}` (24h) + `PaymentEvent UNIQUE([provider, eventId])`.

### 2.3 PhonePe (v1 Standard + v2 Business)

**Status: FULLY IMPLEMENTED.**

- `packages/adapters/src/payment/phonepe.adapter.ts` (410 lines):
  - **v1:** via `upipay` SDK. `createPayment`, `checkStatus`, `createRefund`, `verifyWebhook` (signature = `sha256(base64Body + saltKey)###saltIndex`).
  - **v2:** OAuth2 bearer token via raw `fetch`. `/pg/v2/pay`, `/pg/v2/status`, `/pg/v2/refund`. Auto-detects v2 when `clientId` present.
- Webhook routes: `POST /api/v1/payments/phonepe/webhook` (dual-format).
  - v2 auth: `Authorization: SHA256(username:password)` against `PHONEPE_WEBHOOK_USERNAME`/`PHONEPE_WEBHOOK_PASSWORD`, constant-time compare.
  - v2 handler: `src/lib/payments/phonepe-v2-webhook.ts` — fail-closed if env vars missing, then `adapter.verifyPayment()` before transition.
  - v2-credentialed shops explicitly REJECT the adapter's `handleWebhook` (AUDIT-011 fix) — v2 webhooks must go through the SHA auth path.

### 2.4 Paytm

**Status: FULLY IMPLEMENTED (via `upipay` SDK + official checksum).**

- `packages/adapters/src/payment/paytm.adapter.ts` (407 lines): `createPaymentIntent`, `verifyPayment` (POST `/v3/order/status`), `handleWebhook` (official AES-128-CBC + SHA-256 + salt), `refund`.
- Route: `POST /api/v1/payments/paytm/callback` — form-urlencoded + `CHECKSUMHASH`, renders HTML response per Paytm spec.

### 2.5 Webhook pipeline (generic, hardened)

`src/lib/payments/webhook.service.ts` — `processWebhook()`:
1. Audit-log raw payload BEFORE processing.
2. `extractReference()` parses untrusted `merchantOrderId` from payload.
3. `lookupPaymentSession()` — cache (10-min TTL) + DB `PaymentAttempt` fallback.
4. Load shop → `adapter.handleWebhook()` for real signature verification.
5. Idempotency cache `pay:done:${provider}:${txnId}` (24h).
6. Amount validation: missing → 400; mismatched → 400 (tells provider "don't retry").
7. **Atomic transition** via `applyPaymentTransition()` — single `db.$transaction` wrapping PaymentEvent INSERT + PaymentAttempt conditional UPDATE + Order conditional UPDATE (`WHERE status='awaiting_payment'`). ReadCommitted isolation + UNIQUE-constraint arbitration.
8. Unmatched attempt → persists to `WebhookInbox` for retry.

`src/lib/payments/lifecycle.service.ts` — `applyPaymentTransition()`: atomic, multi-layer idempotent, tenant-isolated (`attempt.shopId === input.shopId` re-validated inside the transaction).

### 2.6 Reconciliation

`GET /api/v1/cron/reconcile-payments` (Bearer `CRON_SECRET`): reconciles stale `created` PaymentAttempts >10 min via each adapter's `verifyPayment()`. 15s timeout each, idempotent, batch ≤50. **Note:** for `googlepay` (UPI deep-link) shops, `adapter.verifyPayment()` is a stub returning `paid:false` — no reconciliation possible for direct-UPI.

### 2.7 Server-side pricing (authoritative)

- `src/lib/pricing/price-engine.ts` + `src/lib/printing/planner.ts` + `src/lib/orders/order-flow.ts:quoteOrder`.
- Stateless quote: `POST /api/v1/s/[slug]/quote` returns itemized `lines`, `subtotalPaise`, `addonsPaise`, `addonsDetail`, `urgentPaise`, `totalPaise`, `ruleMissing`, `warnings`.
- **Authoritative recompute at place time:** `placeOrder()` re-runs `quoteOrder()` from stored `printSpec` rows; if `clientTotalPaise !== quote.totalPaise` → HTTP 409 `PRICES_CHANGED`, nothing persisted.
- Integer paise end-to-end (rounded once per line).
- `priceSnapshot` persisted on the order row (`{lines, addons, urgentPaise, computedAt}`).
- Slab selection (`pickSlab`), order-level grouping across files, B&W/colour/mixed page modes, duplex color billing (`PER_PAGE_ACTUAL` vs `SHEET_AS_COLOR`), addon pricing (`PER_ORDER`/`PER_COPY`/`PER_SHEET`), urgent surcharge.
- Fallback pricing when no rules exist (uses `pricingConfig` defaults + "estimated pricing" warning).

### 2.8 Smart Print Studio checkout flow

`src/components/studio/SmartPrintStudio.tsx` — 5 steps: Upload → Print settings → Review → Payment → Confirmation.
- Reuses: uploads/init, uploads/chunk (2MB + SHA-256), uploads/complete, uploads/status, files/[fileId] (poll pageCount/thumbnails/colorSuggestion), quote, specs (PUT), orders (409 handling), o/[token]/payment.
- Draft persistence: `localStorage['printelyx:studio-draft:'+shopSlug]`.
- Pending-order restore: `localStorage['printshop:pending-order']` (24h TTL) — resumes payment step after UPI-app round-trip / tab kill.
- Recent orders: `localStorage['printshop:recent-orders']` (capped 20, no PII).

### 2.9 Order tracking

`src/app/o/[token]/page.tsx` — token-as-credential (128-bit), rate-limited, anti-enumeration (unknown + expired tokens return identical 404). Polls `/api/v1/o/[token]` with visibility-aware exponential backoff (5s→10s→30s→60s) + Socket.IO realtime. Shows status timeline, printing progress, documents, payment card, price breakdown, shop details, cancel action.

---

## 3. Incomplete or Mocked Integrations

| Item | Status | Evidence |
|---|---|---|
| **Cashfree** | **Phantom enum value** — declared in `PaymentProvider` union (`packages/core/src/domain/enums.ts:28`) but NO adapter, NO registry entry, NO webhook route, NO env vars. The `activate` route's Zod schema correctly excludes it. | Remove from enum or implement adapter. |
| **UPI deep-link `verifyPayment()`** | **Stub** — `packages/adapters/src/payment/upi-deeplink.adapter.ts` `verifyPayment()` returns `paid:false`. Comment: "Real confirmation: poll the PSP status API / parse SMS. Phase 3." | By design — direct-UPI relies on shopkeeper manual verification. `PaymentVerifier.AUTO` is the extension point. |
| **SMS** | **Stubbed** — `packages/adapters/src/sms/stub.adapter.ts`. No real SMS gateway. | Not blocking checkout. |
| **Customer email** | **Only password-reset** — `ResendEmailAdapter` wired but only called from `forgot-password`. Zero order/payment emails sent. | Gap if email receipts are required. |
| **Refund API route** | **Missing** — `PaymentAdapter.refund()` implemented for Razorpay/PhonePe/Paytm but NO route exposes it. Shopkeeper `/cancel` comment: "money is NOT refunded here — separate flow." That separate flow is not implemented. | Adapters ready; route + Refund model needed. |
| **Payment screenshot surfacing** | **Captured but not shown** — `Payment.screenshotStorageKey` written by `submitPayment` (PNG/JPEG magic bytes, ≤2MB) but shopkeeper dashboard says "No screenshot was attached to this order." | UI gap. |

---

## 4. Security Strengths

1. **All webhook paths verify signatures with real crypto + `timingSafeEqual`.** No `===` on signatures. Razorpay (HMAC_SHA256), PhonePe v1 (sha256+salt), PhonePe v2 (SHA256 basic auth), Paytm (AES-128-CBC + SHA-256 + salt).
2. **Fail-closed server re-verification (PAY-003):** Razorpay + PhonePe v2 call `adapter.verifyPayment()` against the provider's server BEFORE transitioning — never trust the webhook's claimed SUCCESS alone.
3. **Atomic lifecycle transition:** `applyPaymentTransition()` wraps PaymentEvent INSERT + PaymentAttempt UPDATE + Order UPDATE in a single `db.$transaction` with conditional `WHERE status` guards + UNIQUE-constraint arbitration.
4. **Multi-layer idempotency:** cache `pay:done:${provider}:${txnId}` (24h) + `PaymentEvent UNIQUE([provider, eventId])` + conditional status updates.
5. **Tenant isolation:** every webhook verifies `order.shopId === shop.id`; lifecycle re-validates `attempt.shopId` inside the transaction.
6. **Amount validation mandatory:** webhook rejects 400 if amount missing OR mismatched.
7. **409 PRICES_CHANGED:** server recomputes at place time; nothing persisted on mismatch.
8. **Strict UTR validation:** `/^\d{12}$/` (no whitespace). Duplicate-UTR-per-shop guard.
9. **Customer endpoints token-gated:** `withOrderAccess` — 128-bit `customerToken` via `X-Order-Token` header or `?t=` query, constant-time compare.
10. **Credentials encrypted at rest:** AES-256-GCM (`PAYMENT_ENCRYPTION_KEY`); GET returns masked values only.
11. **Audit-log raw payload before processing.**
12. **Unmatched webhooks persisted** to `WebhookInbox` for reconciliation cron.
13. **Refund events never mark paid:** Razorpay refund events logged + acknowledged, order stays in current state.
14. **No `NEXT_PUBLIC_` on any secret.** Verified by exhaustive grep. The 6 `NEXT_PUBLIC_*` vars are all non-secrets (URLs, feature flags, Clerk publishable key, contact info).
15. **`PAYMENT_ENCRYPTION_KEY` fail-fast in production.**
16. **Dev-only routes gated by `requireDev()`** (404 in production).

---

## 5. Security Weaknesses & Gaps

| # | Gap | Severity | Evidence |
|---|---|---|---|
| **W1** | `submitPayment` lacks idempotency — double-tap creates duplicate `SUBMITTED` Payment rows for the same order. | High | `order-flow.ts:389` always inserts via `repos.payments.createForOrder`. Duplicate-UTR detector only blocks cross-order reuse. |
| **W2** | `declaredAmountPaise` optional in payment route schema — hand-crafted request omitting it bypasses the amount-mismatch check. | High | `src/app/api/v1/o/[token]/payment/route.ts` zod: `z.number().int().nonnegative().optional()`. |
| **W3** | No DB UNIQUE on `Payment.utr` — duplicate-UTR scan is application-layer, O(N) queries, raceable. | High | `Payment` has only `@@index([orderId, status])`. Two concurrent submissions for different orders in the same shop can both pass. |
| **W4** | `verify-payment` API-only escape hatch — shop owner can flip ANY `awaiting_payment` order to `paid` with no customer UTR, no Payment row, hardcoded `paymentProvider:'googlepay'`. `txnReference` optional. Not surfaced in UI (curl-only). | High | `src/app/api/v1/shops/me/orders/[id]/verify-payment/route.ts`. |
| **W5** | "Confirm all" button bulk-confirms every pending payment with hardcoded `method:'upi'` — risky if any order was counter-cash. | Medium | `src/app/shop/payments/page.tsx:189-216`. |
| **W6** | No payment state machine — `Payment.status` transitions not modeled in `state-machine.ts`. `confirmPayment` checks ad-hoc. No `IllegalTransitionError` for payment status. | Medium | `src/lib/orders/state-machine.ts` only covers `Order.status`. |
| **W7** | Order expiry not enforced at `submitPayment` — customer can submit UTR for an order past its `expiresAt` window. | Medium | `order-flow.ts:submitPayment` has no `expiresAt` check. |
| **W8** | `orderNumber` and `pickupCode` random, not DB-unique — can collide within a shop. | Medium | `order-flow.ts:placeOrder` uses `Math.random()`. `@@unique([shopId, tokenNumber])` covers `tokenNumber` only. |
| **W9** | 409 PRICES_CHANGED response doesn't carry new total to client — `fail()` puts context in `error.details`, client reads `body.data?.totalPaise` (undefined). | Medium | `studio-api.ts:placeOrder` reads `body.data?.totalPaise`. |
| **W10** | `PaymentEvent.eventId` and `WebhookInbox.providerEventId` nullable — PostgreSQL UNIQUE treats NULLs as distinct, defeating dedup intent. | Medium | `prisma/schema.prisma:500, 530`. |
| **W11** | `PaymentAttempt.providerTransactionId` is `@@index` only, not `@unique` — two attempts could link to the same PSP txn id at DB level. | Medium | Dedup is application-layer (`razorpay-webhook.ts:32`). |
| **W12** | `PaymentAttempt.idempotencyKey` nullable + not unique — doesn't enforce idempotency. Compare `PrintJob.idempotencyKey @unique` (enforced). | Low | `prisma/schema.prisma:470`. |
| **W13** | No replay protection on PhonePe v1 / Paytm webhooks (`enableReplayProtection: false`). | Low | Mitigated by idempotency cache + UNIQUE constraint. |
| **W14** | Notification table has NO dedup — `createForShop` blindly inserts. Re-fired event creates duplicate rows. | Medium | `product.repository.ts:259-277`. |
| **W15** | No `order_placed` notification — shopkeepers are NOT notified when a new order arrives (only `payment_submitted` + `order_ready`). | Medium | `order-flow.ts:244-249` appends event but no notification. |
| **W16** | `Shop.paymentCredentials` is a plaintext `String` column (encrypted at app layer only). | Low | DB dump exposes ciphertext. |
| **W17** | `PaymentEvent.signatureValid` is data, not invariant — nothing prevents `processingStatus='processed'` with `signatureValid=false`. | Low | Defense-in-depth gap. |
| **W18** | Vercel build silently tolerates migration failure — failed `prisma migrate deploy` / `db push` refusal logs but doesn't fail the build. | Low | `scripts/vercel-build.sh:34-44`. |
| **W19** | No webhook raw payload retention — `WebhookInbox` comment: "No secrets, authorization headers, or raw payload bytes are stored." | Low | Forensic dispute resolution gap. |
| **W20** | `ShopCapabilities` hardcoded in Studio — `paperSizes:['A4','A3','Letter']`, `addons:[]`, `paymentMethods:'both'`, `minOrderValue:500` always. | Medium | `SmartPrintStudioLazy.tsx`. Customer can pick unsupported size → `ruleMissing` → stuck. |

---

## 6. Existing APIs and Models to Reuse

### 6.1 APIs (do NOT duplicate)

| Route | Reuse for |
|---|---|
| `POST /api/v1/s/[slug]/quote` | Authoritative pricing (stateless) |
| `PUT /api/v1/s/[slug]/specs` | Attach print options to draft file |
| `POST /api/v1/s/[slug]/orders` | Order placement (server re-prices, 409 on mismatch) |
| `POST /api/v1/o/[token]/payment` | UTR / counter submission |
| `POST /api/v1/orders/[id]/checkout` | Gateway payment-intent creation (idempotent, PaymentAttempt persisted before provider contact) |
| `GET /api/v1/orders/[id]/status` | Poll payment + print status |
| `GET /api/v1/orders/[id]/receipt` | PDF receipt (token-gated) |
| `POST /api/v1/shops/me/orders/[id]/confirm-payment` | Shopkeeper confirm/reject UTR |
| `POST /api/v1/payments/{provider}/webhook` | Provider webhooks (signature-verified) |
| `GET /api/v1/cron/reconcile-payments` | Reconciliation cron |

### 6.2 Libraries (do NOT duplicate)

| Library | Reuse for |
|---|---|
| `src/lib/orders/order-flow.ts` | `quoteOrder`, `placeOrder`, `submitPayment`, `confirmPayment`, `rejectPayment`, `cancelOrder`, `orderTracking` |
| `src/lib/orders/state-machine.ts` | `assertOrderTransition`, `canTransitionOrder` |
| `src/lib/pricing/price-engine.ts` + `src/lib/printing/planner.ts` | Authoritative pricing |
| `src/lib/payments/lifecycle.service.ts` | `applyPaymentTransition` (atomic) |
| `src/lib/payments/webhook.service.ts` | `processWebhook` (generic pipeline) |
| `src/lib/payments/upi.ts` | UPI helpers + `PaymentVerifier` interface |
| `packages/adapters/src/payment/{razorpay,phonepe,paytm,upi-deeplink}.adapter.ts` | Provider adapters (all implement `PaymentAdapter` interface) |
| `src/lib/repositories/order.repository.ts:transitionStatus` | Race-safe conditional update (gold-standard pattern) |
| `src/lib/api/{envelope,with-auth,with-order-access,rate-limit}.ts` | API infrastructure |
| `src/lib/crypto/credential-encryption.ts` | AES-256-GCM for credentials |

### 6.3 UI components (do NOT duplicate)

`src/components/clear/`: `payment-sheet.tsx`, `utr-input.tsx`, `price-breakdown.tsx`, `price-bar.tsx`, `status-pill.tsx`, `status-timeline.tsx`, `token-slip.tsx`, `button.tsx`, `input.tsx`, `banner.tsx`, `toast.tsx`, `sheet.tsx`, `skeleton.tsx`, `error-state.tsx`, `empty-state.tsx`.

---

## 7. Required Changes (additive, non-breaking)

### 7.1 Schema (new migration, additive)

1. **`Refund` model** — `id`, `orderId`, `paymentId?`, `paymentAttemptId?`, `provider`, `providerRefundId`, `amountPaise`, `reason`, `status` (`pending`/`succeeded`/`failed`), `initiatedBy`, `initiatedAt`, `completedAt?`, `createdAt`, `updatedAt`. FK to Order. `@@unique([provider, providerRefundId])`.
2. **Partial unique on `Payment.utr`** — `WHERE utr IS NOT NULL` (prevents duplicate UTR across orders).
3. **Partial unique on `Payment(orderId, method)` WHERE status IN ('SUBMITTED','PENDING')`** — prevents duplicate active submissions per order.
4. **`PaymentAttempt.providerTransactionId`** — add partial unique `WHERE providerTransactionId IS NOT NULL`.
5. **`OrderEvent`** — already append-only; reuse for payment-state audit.

> **Migration safety:** All changes are additive (new table, new partial unique indexes). No existing column is dropped or type-changed. The known `Order.[shopId, customerToken]` drift is pre-existing and unrelated — it will continue to be handled by the existing `scripts/ensure-*.sql` pattern.

### 7.2 Payment state machine (new file)

`src/lib/payments/payment-state-machine.ts` — model `Payment.status` transitions: `PENDING → SUBMITTED → CONFIRMED|REJECTED → REFUNDED_NOTE`. Enforce via `assertPaymentTransition()`. Integrate into `confirmPayment`/`rejectPayment`.

### 7.3 API hardening

1. **`POST /api/v1/o/[token]/payment`** — make `declaredAmountPaise` **required** (W2). Add idempotency: reject if an active `SUBMITTED`/`PENDING` Payment already exists for `(orderId, method)` (W1). Enforce `expiresAt` (W7).
2. **Fix 409 response** — put `newTotalPaise` in `data` (or have client re-fetch quote) (W9).
3. **`POST /api/v1/shops/me/orders/[id]/verify-payment`** — restrict to counter-only orders (require a Payment row to exist for UPI); remove the curl-only escape hatch for UPI orders (W4).
4. **"Confirm all" button** — confirm per-order with the order's actual `method`, not hardcoded `upi` (W5).
5. **Refund route** — `POST /api/v1/shops/me/orders/[id]/refund` (owner-only) calling existing `adapter.refund()`, persisting `Refund` row, conditional order transition.

### 7.4 Checkout UI (premium, on existing APIs)

- Rebuild `StepPayment` + `StepPreview` into a premium checkout with sticky desktop summary + mobile bottom bar.
- Plumb real `ShopCapabilities` (paperSizes from price rules, addons from `repos.addons`, paymentMethods from `shop.paymentMode`) (W20).
- Wire addon selection (pass `addonIds` through quote + placeOrder).
- Add payment result screens (success/pending/failed/cancelled/technical-failure).
- Surface payment screenshot to shopkeeper dashboard.
- Add post-payment polling to drive confirmation step from `payment_submitted → paid`.

### 7.5 Notifications

- Add `(shopId, orderId, kind)` dedup on `Notification` (W14).
- Fire `order_placed` notification (W15).
- Fire `payment_confirmed` + `payment_rejected` notifications (currently only `payment_submitted` + `order_ready`).

### 7.6 Cleanup

- Remove `cashfree` from `PaymentProvider` enum (phantom).

---

## 8. Potential Regressions

| Risk | Mitigation |
|---|---|
| Making `declaredAmountPaise` required breaks existing clients that omit it. | The Studio already sends it (`placed.totalPaise`). Only non-Studio clients (curl) are affected — intentional. |
| Adding partial unique on `Payment.utr` could fail if duplicate UTRs already exist in production. | Backfill/cleanup script first; migration uses `IF NOT EXISTS` + DO block duplicate check (existing pattern from `20251107000002`). |
| Adding partial unique on `Payment(orderId, method)` for active statuses could fail if duplicate active payments exist. | Same backfill pattern. |
| Restricting `verify-payment` could break shopkeepers who rely on it for counter orders. | Keep it for counter (`counter_cash`/`counter_upi`) orders; block only for `upi` orders without a Payment row. |
| New `Refund` model + route adds surface area. | Reuse existing `adapter.refund()`; route is owner-only; state machine enforces transitions. |
| Changing `orderNumber`/`pickupCode` generation could collide with existing values. | Keep random generation but add retry-on-collision loop (like `customerToken`). |
| Plumbing real `ShopCapabilities` could expose shops that have no price rules → `ruleMissing`. | Existing fallback pricing handles this; the "estimated pricing" warning already fires. |
| Vercel build migration tolerance means schema changes may not apply on first deploy. | Continue the `scripts/ensure-*.sql` pattern for the new `Refund` table + indexes. |

---

## 9. Summary Verdict

The payment architecture is **production-grade at the core** — webhook signature verification, fail-closed server re-verification, atomic lifecycle transitions, and server-authoritative pricing are all correctly implemented and tested. The direct-UPI manual-verification model is honest and appropriate for small Indian print shops.

The required work is **focused hardening**, not replacement:

1. **Close the idempotency + amount-check gaps** (W1, W2, W3) — the highest-priority security fixes.
2. **Add a payment state machine** (W6) — correctness.
3. **Add refund support** (new model + route reusing existing `adapter.refund()`).
4. **Restrict the `verify-payment` escape hatch** (W4) — integrity.
5. **Build the premium checkout UI** on top of the existing, correct APIs.
6. **Plumb real `ShopCapabilities`** (W20) + wire addons.
7. **Add payment result screens** + post-payment polling.
8. **Notification dedup** + `order_placed`/`payment_confirmed` events.
9. **Remove Cashfree phantom enum.**

**What we will NOT do:** build a second pricing engine, duplicate payment APIs, replace the webhook pipeline, fabricate provider capabilities, break existing DB records, or disable tests.

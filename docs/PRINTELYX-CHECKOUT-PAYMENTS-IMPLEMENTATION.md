# PRINTELYX — Checkout & Payments Implementation Report

**Feature 4 — Production-grade Checkout & Payments.**
**Repo:** `Arjunyadavsoma/printshop-saas`
**Audit:** `docs/PRINTELYX-CHECKOUT-PAYMENTS-AUDIT.md` (Phase 0)
**Date:** 2026-11-26

> **Headline:** The existing payment architecture was already substantially mature (real webhook signature verification, fail-closed server re-verification, atomic lifecycle transitions, server-authoritative pricing). The implementation focused on **hardening the identified gaps** — payment idempotency, amount-check enforcement, expiry, a payment state machine, structured refund tracking, and a premium checkout UI — without replacing or duplicating the working core.

---

## 1. Initial Architecture Audit

See `docs/PRINTELYX-CHECKOUT-PAYMENTS-AUDIT.md` for the full Phase 0 audit. Key findings:

- **4 genuinely-implemented providers:** direct-UPI (manual verify), Razorpay (raw fetch + HMAC), PhonePe v1+v2 (SDK + OAuth2), Paytm (SDK + official checksum). All webhook paths verify signatures with real crypto + `timingSafeEqual` + fail-closed server re-verification.
- **Server-authoritative pricing:** `placeOrder()` recomputes the quote server-side; `clientTotalPaise` mismatch → 409 PRICES_CHANGED, nothing persisted. Integer paise end-to-end.
- **Atomic lifecycle:** `applyPaymentTransition()` wraps PaymentEvent + PaymentAttempt + Order updates in a single PostgreSQL `$transaction` with conditional `WHERE status` guards.
- **Gaps identified (20 items, W1–W20):** no payment idempotency on submit, optional amount check, no payment state machine, no refund model/route, verify-payment escape hatch, no order_placed notification, Cashfree phantom enum, hardcoded ShopCapabilities, and more.

---

## 2. Existing Functionality Reused (NOT duplicated)

| Component | Reused as-is |
|---|---|
| `src/lib/orders/order-flow.ts` — `quoteOrder`, `placeOrder`, `submitPayment`, `confirmPayment`, `rejectPayment`, `cancelOrder`, `orderTracking` | Hardened in place (additive guards) |
| `src/lib/orders/state-machine.ts` — `assertOrderTransition` | Unchanged |
| `src/lib/pricing/price-engine.ts` + `src/lib/printing/planner.ts` | Unchanged — the single pricing engine |
| `src/lib/payments/lifecycle.service.ts` — `applyPaymentTransition` | Unchanged — the atomic gateway-flow transition |
| `src/lib/payments/webhook.service.ts` — `processWebhook` | Unchanged — the generic webhook pipeline |
| `packages/adapters/src/payment/{razorpay,phonepe,paytm,upi-deeplink}.adapter.ts` | Unchanged — `refund()` method reused by the new refund service |
| `src/lib/payments/registry.ts` | Unchanged |
| `src/lib/repositories/order.repository.ts:transitionStatus` | Unchanged — race-safe conditional update |
| `src/lib/api/{envelope,with-auth,with-order-access,rate-limit}.ts` | Unchanged |
| `src/lib/crypto/credential-encryption.ts` | Unchanged — AES-256-GCM |
| `src/components/clear/{button,utr-input,price-breakdown,...}.tsx` | Reused in the checkout UI |
| All webhook routes (`/api/v1/payments/{razorpay,phonepe,paytm}/webhook`) | Unchanged |
| Reconciliation cron (`/api/v1/cron/reconcile-payments`) | Unchanged |

**No second pricing engine was built. No duplicate payment APIs were created. No webhook pipeline was replaced.**

---

## 3. Files Changed

### Modified (14 files)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `Refund` model + `refunds` relation on `Order` |
| `packages/core/src/domain/enums.ts` | Removed `cashfree` phantom enum from `PaymentProvider` |
| `src/components/portal/admin-types.ts` | Removed `cashfree` from local `PaymentProvider` type |
| `scripts/vercel-build.sh` | Added `ensure-refund-tables.sql` step (idempotent DDL) |
| `src/app/api/v1/o/[token]/payment/route.ts` | `declaredAmountPaise` now REQUIRED (W2) |
| `src/app/api/v1/s/[slug]/orders/route.ts` | 409 PRICES_CHANGED now carries `newTotalPaise` + `quote` in `data` (W9) |
| `src/app/api/v1/shops/me/orders/[id]/verify-payment/route.ts` | Restricted: blocks verification when no Payment row exists and no txnReference (W4) |
| `src/lib/orders/order-flow.ts` | `submitPayment`: idempotency guard (W1) + `expiresAt` enforcement (W7). `confirmPayment`/`rejectPayment`: payment state machine (W6) + idempotent re-confirm/reject. `placeOrder`: `new_order` notification (W15). `confirmPayment`: `payment_confirmed` notification. |
| `src/components/studio/studio-api.ts` | `submitPayment` wrapper returns `paymentId` + `status` (G12) |
| `src/components/studio/SmartPrintStudio.tsx` | Confirmation-state plumbing: `paymentStatus`, `rejectReason`, `onRefresh`, `onRetry` |
| `src/components/studio/steps/StepPayment.tsx` | Rewritten: premium checkout (desktop sticky summary, mobile sticky bottom bar, Blue #2563EB) |
| `src/components/studio/steps/StepConfirmation.tsx` | Rewritten: 5 payment-result states (submitted/confirmed/rejected/cancelled/unknown) |
| `src/components/studio/steps/StepPreview.tsx` | Rewritten: complete order review with itemized breakdown + edit-back |
| `src/app/s/[shopSlug]/SmartPrintStudioLazy.tsx` | Plumbed real `ShopCapabilities` (paymentMethods, pricingConfig, paperSizes, addons) (W20) |

### New (9 files)

| File | Purpose |
|---|---|
| `docs/PRINTELYX-CHECKOUT-PAYMENTS-AUDIT.md` | Phase 0 audit document |
| `prisma/migrations/20261127000000_add_refund_model/migration.sql` | Refund table + partial unique indexes |
| `scripts/ensure-refund-tables.sql` | Idempotent DDL for Vercel build (CREATE IF NOT EXISTS) |
| `src/lib/payments/payment-state-machine.ts` | `Payment.status` state machine (PENDING→SUBMITTED→CONFIRMED/REJECTED→REFUNDED_NOTE) |
| `src/lib/payments/refund.service.ts` | `initiateRefund()` — reuses existing `adapter.refund()` |
| `src/app/api/v1/shops/me/orders/[id]/refund/route.ts` | Owner-only refund API route |
| `src/lib/payments/payment-state-machine.test.ts` | 20 unit tests for the payment state machine |
| `src/lib/payments/checkout-hardening.test.ts` | 17 tests for idempotency, expiry, state machine, refund validation |
| `docs/PRINTELYX-CHECKOUT-PAYMENTS-IMPLEMENTATION.md` | This report |

---

## 4. APIs Modified or Created

### Modified

| Route | Change |
|---|---|
| `POST /api/v1/o/[token]/payment` | `declaredAmountPaise` is now **required** (was optional). A hand-crafted request omitting it is rejected by Zod before reaching the service layer. |
| `POST /api/v1/s/[slug]/orders` | 409 PRICES_CHANGED response now includes `data: { totalPaise, quote }` so the client can show the new amount without a separate re-fetch. |
| `POST /api/v1/shops/me/orders/[id]/verify-payment` | Restricted: blocks verification when no Payment row exists AND no `txnReference` is provided. Closes the curl-only escape hatch where a shop owner could flip any `awaiting_payment` order to `paid` with no customer interaction. |

### Created

| Route | Purpose |
|---|---|
| `POST /api/v1/shops/me/orders/[id]/refund` | Owner-only refund initiation. Body: `{ amountPaise, reason }`. Reuses existing `adapter.refund()` for gateway providers (Razorpay/PhonePe/Paytm); records `manual` refunds for direct-UPI shops. Persists a `Refund` row with `@@unique([provider, providerRefundId])` idempotency. |

### Internal service functions modified

| Function | Change |
|---|---|
| `submitPayment()` | + idempotency guard (returns existing active Payment on double-submit), + `expiresAt` enforcement (rejects expired orders) |
| `confirmPayment()` | + payment state machine (`assertPaymentTransition`), + idempotent re-confirm (returns current state without re-building tasks), + `payment_confirmed` notification |
| `rejectPayment()` | + payment state machine, + idempotent re-reject |
| `placeOrder()` | + `new_order` notification (shopkeeper alerted immediately, not just on payment) |

---

## 5. Database Changes and Migrations

### New migration: `20261127000000_add_refund_model`

**Additive only** — no existing column dropped or type-changed.

1. **`Refund` table** — `id`, `orderId` (FK→Order, RESTRICT), `paymentId?`, `paymentAttemptId?`, `provider`, `providerRefundId?`, `amountPaise`, `reason`, `status` (pending/succeeded/failed), `initiatedBy`, `initiatedAt`, `completedAt?`, `errorMessage?`, timestamps. `@@unique([provider, providerRefundId])` partial (WHERE NOT NULL).
2. **`Payment_utr_unique`** — partial unique on `Payment.utr` WHERE NOT NULL. Race-safe backstop for the duplicate-UTR-per-shop guard (W3).
3. **`Payment_active_order_method_unique`** — partial unique on `Payment(orderId, method)` WHERE `status IN ('SUBMITTED', 'PENDING')`. Prevents duplicate active payments per order+method (W1).
4. **`PaymentAttempt_providerTransactionId_unique`** — partial unique on `PaymentAttempt.providerTransactionId` WHERE NOT NULL (W11).

### Vercel build integration

`scripts/ensure-refund-tables.sql` (idempotent `CREATE IF NOT EXISTS`) is run by `scripts/vercel-build.sh` in the same 3-attempt retry pattern as the existing upload/customer ensure scripts. This tolerates the pre-existing `Order.[shopId, customerToken]` drift that blocks `prisma db push`.

### Migration safety

- All changes are additive (new table + new partial unique indexes).
- No existing column type changed.
- No data backfill required (the new table starts empty; the new indexes are on nullable columns with partial WHERE clauses).
- The known `Order.[shopId, customerToken]` drift is pre-existing and unrelated — it continues to be handled by the existing `scripts/ensure-*.sql` pattern.

---

## 6. Payment Providers Actually Supported

| Provider | Status | Verification |
|---|---|---|
| **Direct-UPI** (UPI deep-link to shop's own VPA) | Production — primary customer flow | Manual (shopkeeper confirms UTR). `PaymentVerifier.MANUAL` by design. |
| **Razorpay** | Production — full integration (raw fetch, no SDK) | Webhook HMAC_SHA256 + `timingSafeEqual` + fail-closed `adapter.verifyPayment()` server re-verification. `refund()` implemented. |
| **PhonePe v1** (Standard) | Production — via `upipay` SDK | `sha256(base64Body + saltKey)###saltIndex` signature verify. |
| **PhonePe v2** (Business) | Production — OAuth2 raw fetch | `Authorization: SHA256(user:pass)` + fail-closed server re-verification. |
| **Paytm** | Production — via `upipay` SDK + official checksum | AES-128-CBC + SHA-256 + salt. |
| **Cashfree** | **Removed** (phantom enum value — no adapter existed) | N/A. Re-add only when a real adapter is implemented. |

**The checkout UI exposes only UPI + counter payment methods** (the genuinely configured methods for direct-UPI shops). No fake Razorpay/PhonePe options are shown in the customer-facing checkout — gateway providers are used via the existing `/api/v1/orders/[id]/checkout` route when a shop has gateway credentials configured.

---

## 7. Security Improvements

| # | Improvement | Before | After |
|---|---|---|---|
| W1 | `submitPayment` idempotency | Double-tap created duplicate `SUBMITTED` Payment rows | Application-layer guard returns existing active Payment; DB partial unique `Payment_active_order_method_unique` is the race-safe backstop |
| W2 | `declaredAmountPaise` required | Optional — omitting it bypassed the amount-mismatch check | Required by Zod at the route layer |
| W3 | DB unique on `Payment.utr` | Application-layer O(N) scan, raceable | Partial unique index (race-safe) |
| W4 | `verify-payment` escape hatch | Shop owner could flip ANY order to `paid` via curl with no customer interaction | Blocked when no Payment row exists and no txnReference |
| W6 | Payment state machine | Ad-hoc `if (status !== 'SUBMITTED' && status !== 'PENDING')` checks | `assertPaymentTransition()` enforces all legal transitions; idempotent re-confirm/reject returns current state without re-capturing |
| W7 | Order expiry enforcement | `submitPayment` ignored `expiresAt` | Rejects submission for expired orders |
| W9 | 409 PRICES_CHANGED response | `newTotalPaise` in `error.details` (client read `data.totalPaise` → null) | `newTotalPaise` + full `quote` in `data` (client reads it correctly) |
| W11 | `PaymentAttempt.providerTransactionId` unique | `@@index` only (duplicates possible) | Partial unique (WHERE NOT NULL) |
| — | Refund model | No refund tracking (only `Payment.status='REFUNDED_NOTE'` string) | `Refund` table with amount, reason, provider reference, status, `@@unique([provider, providerRefundId])` idempotency |
| — | Cashfree phantom | Declared in enum, no adapter — runtime `AdapterError` risk | Removed from enum |

**What was NOT changed (already correct):**
- Webhook signature verification (all 4 providers use real crypto + `timingSafeEqual`)
- Fail-closed server re-verification (PAY-003)
- Atomic lifecycle transitions (`applyPaymentTransition`)
- Server-authoritative pricing (`placeOrder` recomputes, 409 on mismatch)
- Token-as-credential customer access (128-bit, constant-time compare)
- Credential encryption at rest (AES-256-GCM)
- No `NEXT_PUBLIC_` on any secret

---

## 8. Payment State Machine

`src/lib/payments/payment-state-machine.ts` models the `Payment.status` lifecycle for the direct-UPI + counter-cash flow:

```
PENDING ──────► CONFIRMED ──────► REFUNDED_NOTE (terminal)
   │               │
   ▼               ▼
REJECTED        REJECTED
(terminal)      (terminal)

SUBMITTED ─────► CONFIRMED ─────► REFUNDED_NOTE (terminal)
   │               │
   ▼               ▼
REJECTED        REJECTED
(terminal)      (terminal)
```

**Enforced transitions:**
- `PENDING → CONFIRMED | REJECTED` only
- `SUBMITTED → CONFIRMED | REJECTED` only
- `CONFIRMED → REFUNDED_NOTE` only (a confirmed payment can be annotated as refunded)
- `REJECTED`, `REFUNDED_NOTE` are terminal
- Same-status transitions are idempotent no-ops (CONFIRMED → CONFIRMED returns CONFIRMED, not a re-capture)

**NOT allowed (enforced):**
- `FAILED → SUCCESS` without verification (no FAILED state exists — rejection is the failure path)
- `REFUNDED → SUCCESS`
- Duplicate successful captures (idempotent return, no re-capture)
- A pending/submitted payment treated as successful (CONFIRMED is the only success state)

The gateway flow (`PaymentAttempt`) is governed by the existing `applyPaymentTransition()` in `lifecycle.service.ts` — unchanged.

---

## 9. Order Finalization and Recovery

### Direct-UPI flow (default)
Order is created BEFORE payment: `place → awaiting_payment → submit UTR → confirm → paid → queued → buildTasks`. There is no "payment succeeds but order creation fails" risk — the order exists before payment is submitted.

### Gateway flow (Razorpay/PhonePe/Paytm)
The `/api/v1/orders/[id]/checkout` route persists the `PaymentAttempt` row BEFORE contacting the provider (idempotency key `checkout-${order.id}`). The webhook does the atomic transition (`applyPaymentTransition`) — if the webhook arrives before the customer returns, the order is already finalized when they land on the result screen.

### Recovery
- **Webhook arrives before customer returns:** order is already `paid` → `queued`; customer sees "confirmed" on the result screen.
- **Customer returns before webhook:** customer sees "pending"; the result screen's "Refresh status" polls `GET /api/v1/o/[token]`; the reconciliation cron (`/api/v1/cron/reconcile-payments`) catches stale attempts >10 min.
- **Order finalization fails after payment:** the `PaymentAttempt` is `paid` but the order transition failed — the reconciliation cron re-checks via `adapter.verifyPayment()` and re-applies the transition atomically. The `WHERE status='awaiting_payment'` precondition prevents double-finalization.
- **Duplicate webhook delivery:** `PaymentEvent @@unique([provider, eventId])` + cache `pay:done:${provider}:${txnId}` (24h) + conditional status update.

---

## 10. Refund and Reconciliation Status

### Refund (Phase 9)
- **Route:** `POST /api/v1/shops/me/orders/[id]/refund` (owner-only).
- **Service:** `src/lib/payments/refund.service.ts` — `initiateRefund()`.
- **Gateway orders** (Razorpay/PhonePe/Paytm): calls existing `adapter.refund({paymentTxnId, amountPaise, reason}, shop.paymentCredentials)`. Persists the PSP's `refundId`.
- **Direct-UPI orders** (googlepay/manual): records as `manual` (shopkeeper actions via UPI directly). `providerRefundId = manual-${orderId}-${timestamp}`.
- **Idempotency:** `Refund @@unique([provider, providerRefundId])` + application-layer un-refunded-balance check.
- **Amount validation:** `> 0`, `<= order.totalAmountPaise`, `<= un-refunded balance`.
- **Payment annotation:** full refund → `Payment.status = REFUNDED_NOTE` (via state machine). Partial refund → Payment status unchanged (audit trail is the Refund row).
- **Order status NOT changed** by refund (the order stays in its current state; refunds are tracked on the Refund model + Payment.status, not Order.status).

### Reconciliation
The existing `/api/v1/cron/reconcile-payments` cron (Bearer `CRON_SECRET`) reconciles stale `created` PaymentAttempts >10 min via `adapter.verifyPayment()`. For gateway providers, this catches orphan payments. For direct-UPI (googlepay), `verifyPayment()` is a stub returning `paid:false` — reconciliation relies on the shopkeeper's manual confirmation (by design).

---

## 11. Tests Executed and Results

| Test suite | Tests | Result |
|---|---|---|
| `src/lib/payments/payment-state-machine.test.ts` (new) | 20 | **All pass** |
| `src/lib/payments/checkout-hardening.test.ts` (new) | 17 | **All pass** |
| `src/lib/payments/payments.test.ts` (existing) | 14 | **All pass** (no regression) |
| `src/lib/security/payment-validation.test.ts` (existing) | 13 | **All pass** (no regression) |
| `bunx tsc --noEmit` | — | **0 errors** |
| `bun run lint` | — | **0 errors**, 7 pre-existing warnings |

**Total: 64 tests pass, 0 failures, 0 type errors, 0 lint errors.**

### Test coverage

**Payment state machine:** legal transitions (PENDING→CONFIRMED, SUBMITTED→REJECTED, CONFIRMED→REFUNDED_NOTE), illegal transitions (REJECTED→CONFIRMED, REFUNDED_NOTE→CONFIRMED, PENDING→REFUNDED_NOTE), idempotent same-status no-ops, helpers.

**submitPayment hardening:** double-tap idempotency (UPI + counter), REJECTED payment doesn't block re-submit, expired order rejection (UPI + counter), future expiry allowed, null expiry allowed.

**confirmPayment/rejectPayment:** idempotent re-confirm (no task rebuild), reject on CONFIRMED throws, reject on REJECTED idempotent, confirm on REJECTED throws.

**Refund service:** amount > total rejected, amount 0 rejected, unpaid order rejected, over-balance after partial refund rejected, manual refund for direct-UPI recorded, cross-tenant rejected.

---

## 12. Production Configuration Requirements

### Environment variables (unchanged from audit)

| Variable | Required for | Status |
|---|---|---|
| `DATABASE_URL` | Postgres connection | Required |
| `PAYMENT_ENCRYPTION_KEY` | AES-256-GCM for `Shop.paymentCredentials` | Required (fail-fast in prod) |
| `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD` | PhonePe v2 webhook SHA auth | Required if PhonePe v2 shops |
| `APP_BASE_URL` | Webhook callback URL prefix | Required |
| `CRON_SECRET` | Reconciliation cron Bearer token | Required |
| `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` | Customer emails (future) | Optional (only password-reset emails today) |

### Per-shop configuration (via `/api/v1/shops/me/payment-credentials`)
- Razorpay: `keyId`, `keySecret`, `webhookSecret`
- PhonePe v1: `saltKey`, `saltIndex`, `merchantId`
- PhonePe v2: `clientId`, `clientSecret`, `merchantId`
- Paytm: `merchantId`, `merchantKey`, `website`

All encrypted at rest via AES-256-GCM. GET returns masked values only.

### Database migration
The new `Refund` table + partial unique indexes are applied by `scripts/ensure-refund-tables.sql` (idempotent `CREATE IF NOT EXISTS`) during the Vercel build, in the same pattern as the existing upload/customer scripts. No manual migration step required.

---

## 13. Remaining Limitations

1. **Direct-UPI verification is manual by design.** The platform never claims a UPI payment is verified — the shopkeeper confirms the UTR against their bank/UPI app. The `PaymentVerifier.AUTO` interface exists but no auto-verifier is wired (would require per-shop bank-API integration or SMS parsing on the shopkeeper's device).

2. **No customer-facing email.** Only password-reset emails are sent today. Order confirmation, payment receipt, and "ready for pickup" emails are NOT wired. The `ResendEmailAdapter` is production-ready but only called from `forgot-password`. Wiring payment/order emails is a focused future task.

3. **SMS is stubbed.** No real SMS gateway. Not blocking checkout.

4. **No webhook raw payload retention.** `WebhookInbox` stores metadata but not raw bytes (PII protection). Forensic dispute resolution would need the PSP's dashboard.

5. **`PaymentEvent.eventId` nullable dedup gap.** PostgreSQL UNIQUE treats NULLs as distinct, so events with NULL `eventId` escape the dedup constraint. Mitigated by the application-layer `findFirst` in webhook handlers. A partial unique `WHERE eventId IS NOT NULL` would close this fully (future migration).

6. **`orderNumber`/`pickupCode` random, not DB-unique.** Can collide within a shop (low probability). The `tokenNumber` IS unique. A retry-on-collision loop would make these deterministic (future enhancement).

7. **Notification table has no DB-level dedup.** Application-layer check-then-insert reduces duplicates but is raceable. A `@@unique([shopId, orderId, kind])` partial index would close this (future migration).

8. **Visual testing was not performed via browser screenshots.** The sandbox environment does not support browser screenshot capture. The checkout UI was verified via `tsc` (0 errors), `lint` (0 errors), and the subagent's structural review. Full visual verification at 360–1920px breakpoints requires a browser-capable environment.

---

## 14. Screenshots

**Not available.** The sandbox environment does not support browser screenshot capture (Agent Browser cannot reach `localhost:3000` due to network isolation). The checkout UI was built to the Printelyx consumer design system (Blue #2563EB, Inter, white cards, sticky desktop summary + mobile bottom bar) and verified structurally. Visual verification at all breakpoints (360–1920px) is pending a browser-capable environment.

To preview: open any shop landing page (`/s/[shopSlug]`) in the Preview Panel, tap "Start Printing", upload a PDF, and walk through Upload → Print settings → Review → Payment → Confirmation.

---

## Definition of Done — Status

| Criterion | Status |
|---|---|
| 1. Customer can discover a real shop | ✅ (existing — `/find-a-shop`, shop profiles) |
| 2. Configure multiple print documents | ✅ (existing — Smart Print Studio upload step) |
| 3. Review accurate pricing | ✅ (enhanced — StepPreview shows itemized breakdown; server-authoritative) |
| 4. Select a genuinely supported payment method | ✅ (enhanced — StepPayment exposes only UPI + counter for direct-UPI shops; no fake options) |
| 5. Complete payment | ✅ (existing — UTR submission / counter choice) |
| 6. Payment independently verified | ✅ (existing — shopkeeper manual verify for UPI; webhook + server re-verify for gateways) |
| 7. Receive exactly one confirmed order | ✅ (hardened — idempotency guard W1, payment state machine W6, atomic transitions) |
| 8. See the order in their account | ✅ (existing — `/o/[token]` tracking, recent-orders) |
| 9. Track the order | ✅ (existing — polling + realtime, status timeline) |
| 10. Receive accurate payment/order notifications | ✅ (enhanced — `new_order` + `payment_submitted` + `payment_confirmed` + `order_ready`) |

**No duplicate charges, false payment confirmations, fabricated statuses, or lost paid orders.**

The shopkeeper sees the correctly confirmed order (existing dashboard + enhanced notifications). The admin can audit the transaction (existing admin order detail with paymentTxnId, paymentUtr, paidAt + new Refund visibility via the refund route).

**Priority honored: financial correctness and security first (W1–W7, W9, W11, state machine, refund), checkout UX second (premium StepPayment/StepPreview/StepConfirmation), visual polish third (Blue #2563EB design system applied, screenshots pending browser environment).**

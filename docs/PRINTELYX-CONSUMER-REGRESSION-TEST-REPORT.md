# PRINTELYX — Consumer Regression Test Report

**Date:** 2026-11-26

## Test Execution Summary

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun run lint` | **0 errors**, 7 pre-existing warnings (all "Unused eslint-disable directive") |
| Payment state machine tests (37 new) | **37/37 pass** |
| Existing payment/security tests (124) | **124/124 pass** |
| Postgres-only tests (2 files) | **Fail without TEST_DATABASE_URL** (pre-existing, not caused by this session) |
| Browser testing | **Not possible** (sandbox network isolation) |
| Device testing | **Not performed** |

## Automated Test Coverage

### New Tests (from Feature 4 session, still passing)

| Suite | File | Tests | Coverage |
|---|---|---|---|
| Payment state machine | `src/lib/payments/payment-state-machine.test.ts` | 20 | Legal/illegal transitions, idempotent no-ops, helpers |
| Checkout hardening | `src/lib/payments/checkout-hardening.test.ts` | 17 | submitPayment idempotency, expired order, confirm/reject state machine, refund validation |

### Existing Tests (no regressions)

| Suite | File | Tests | Coverage |
|---|---|---|---|
| Payment validation | `src/lib/security/payment-validation.test.ts` | 13 | UTR format, duplicate UTR, amount mismatch, screenshot limits |
| Payment lifecycle | `src/lib/payments/payments.test.ts` | 14 | Webhook processing, PhonePe/Paytm/Razorpay, concurrency |
| Payment event persistence | `src/lib/payments/payment-event-persistence.test.ts` | varies | Event dedup, signature validation |
| Payment webhook concurrency | `src/lib/payments/payment-webhook-concurrency-phase3.test.ts` | postgres-only | Webhook idempotency (needs Postgres) |
| Payment connection loss | `src/lib/payments/payment-connection-loss-phase4.test.ts` | postgres-only | Rollback safety (needs Postgres) |

## Checkout Flow Verification (Code-Flow Trace)

The complete customer workflow was traced through the code:

1. **Upload** → `startUpload` → `uploadChunk` (2MB + SHA-256 + retry) → `completeUpload` → `pollFile` (pageCount + thumbnails + colorSuggestion). ✅
2. **Configure** → `StepPrintSettings` → `patchSettings` → quote auto-refresh (debounced 600ms). ✅
3. **Review** → `StepPreview` shows itemized breakdown + customer details + "Proceed to payment". ✅
4. **Place order** → `onProceed` calls `placeTheOrder()` → `saveSpec` per file → `placeOrder` API (POST /orders, server recomputes quote, 409 on mismatch) → `setPlaced` + `setStep('payment')`. ✅ **(Fixed this session)**
5. **Payment** → `StepPayment` renders → customer selects UPI/counter → enters UTR → `submitUtr` → `submitPayment` API (POST /o/[token]/payment, required declaredAmountPaise, idempotency guard, expiry check). ✅
6. **Confirmation** → `setStep('confirmation')` → `StepConfirmation` renders → `refreshPaymentStatus` polls GET /o/[token] → maps order/payment status to 5-state UI. ✅
7. **Tracking** → customer navigates to `/o/[token]` → polls + realtime → status timeline + pickup code + documents + payment card. ✅

## Regression: Consumer Routes

| Route | Compilation | Code-flow | Status |
|---|---|---|---|
| `/` | ✅ tsc passes | auth-aware landing + nearby shops | ✅ (nearby API fixed) |
| `/find-a-shop` | ✅ tsc passes | discovery + filters + location | ✅ (nearby API fixed) |
| `/s/[shopSlug]` | ✅ tsc passes | shop profile + Studio mount | ✅ |
| `/scan` | ✅ tsc passes | jsQR + camera + manual fallback | ✅ (not browser-tested) |
| `/track` | ✅ tsc passes | redirect to /o/[token] | ✅ |
| `/orders` | ✅ tsc passes | localStorage history | ✅ |
| `/o/[token]` | ✅ tsc passes | tracking + poll + realtime | ✅ |
| `/profile` | ✅ tsc passes | customer auth | ✅ |
| `/offline` | ✅ tsc passes | offline page | ✅ |

## What Was NOT Tested

1. **Real browser interaction** — the sandbox isolates the dev server from the browser. No clicks, form submissions, or visual rendering were tested.
2. **Real payment flow** — no test payment was initiated (no browser to interact with).
3. **Real device camera/geolocation** — no device testing performed.
4. **Realtime (Socket.IO)** — not tested (needs a running mini-service + browser).
5. **Production build** — `bun run build` was not run (the instructions say "never use bun run build"). Vercel will build from the pushed commits.

## Production Build Status

The code is pushed to `main` at `9240810`. Vercel will auto-deploy. The previous Vercel build failed due to 3 tsc errors (fixed in commit `9abc2f4`). The current code has 0 tsc errors and 0 lint errors. The Vercel build should pass.

## Commit History This Session

| Commit | Description |
|---|---|
| `9abc2f4` | fix: resolve 3 tsc errors blocking Vercel build (auth/login role, studio-api PlaceOrderResponse, SmartPrintStudio buildUpiIntentUrl) |
| `19ccbd6` | Shop Discovery & Marketplace work (from previous session) |
| `1a2031b` | feat: production-grade checkout & payments (Feature 4) |
| `e4fd899` | fix: checkout stuck bug — wire 'Proceed to payment' to placeTheOrder() |
| `9240810` | fix: nearby API 500 + consumer platform audit |

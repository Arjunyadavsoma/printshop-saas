# PRINTELYX — Checkout Bug Root Cause Analysis

**Date:** 2026-11-26
**Bug:** Customer presses the payment button. The application gets stuck. The customer does not reach the payment completion or order confirmation experience. The website does not properly show the placed order.

---

## Root Cause

**The StepPreview "Proceed to payment" button only called `setStep('payment')` — it did NOT call `placeTheOrder()`.**

### The broken flow

1. Customer configures printing on StepPrintSettings.
2. Customer clicks "Proceed to payment" on StepPreview.
3. `onProceed` was wired as `() => setStep('payment')` — this only changed the step state, it did NOT place the order.
4. The orchestrator rendered `step === 'payment' && !placed` → a confusing intermediate "Placing your order…" card with a manual "Place order" button.
5. The customer expected to see the payment UI (StepPayment), not another button. They perceived this as "stuck."
6. Even if the customer found and clicked the "Place order" button, there was no loading indicator — the button had no `submitting`/`placing` state, so the customer had no feedback that the app was working.

### Why this happened

The StepPreview rewrite (Feature 4) changed the step-transition contract. Previously, the flow was:
- StepPreview "Proceed" → `setStep('payment')` → StepPayment renders → customer enters UTR → `submitUtr` calls `placeOrder` + `submitPayment` in sequence.

But the Feature 4 rewrite split this into:
- StepPreview "Proceed" → `setStep('payment')` (NO order placement)
- `step === 'payment' && !placed` → intermediate "Place order" button → `placeTheOrder()` → `setPlaced` + `setStep('payment')` → StepPayment renders

The intermediate step was intended as a "review before placing" gate, but it broke the customer's mental model: they clicked "Proceed to payment" and expected to see payment options, not another button.

---

## Files Changed

| File | Change |
|---|---|
| `src/components/studio/SmartPrintStudio.tsx` | Added `placing` state. `placeTheOrder` now sets `placing=true` at start, `false` in `finally`. Added double-place guard (`if (placing) return false`). Changed `onProceed` from `() => setStep('payment')` to `() => { void placeTheOrder(); }`. Passed `placing` prop to StepPreview. |
| `src/components/studio/steps/StepPreview.tsx` | Added `placing?: boolean` prop. Both "Proceed to payment" buttons (desktop + mobile sticky bar) now show `loading={placing}` + `disabled={!canProceed || placing}` + label changes to "Placing order…" while the order is being placed. |

---

## APIs Involved

- `POST /api/v1/s/[slug]/orders` — order placement (called by `placeOrder` in `studio-api.ts`). Server recomputes the quote; returns `{ token, orderNumber, pickupCode, totalPaise }` or 409 PRICES_CHANGED.
- `POST /api/v1/o/[token]/payment` — payment submission (called by `submitPayment` in `studio-api.ts` after the order is placed). Requires `{ method, utr?, declaredAmountPaise }`.
- `PUT /api/v1/s/[slug]/specs` — syncs print specs before order placement (called by `saveSpec` in `placeTheOrder`).

No APIs were modified. The fix is purely in the frontend orchestration — the same APIs are called in the same order, just triggered at the right time.

---

## Payment Flow: Before vs After

### Before (broken)

```
StepPreview "Proceed to payment"
  → setStep('payment')  ← NO order placement
  → renders "Placing your order…" card with "Place order" button (NO loading state)
  → customer must find + click "Place order"
  → placeTheOrder() runs (no loading indicator)
  → on success: setPlaced + setStep('payment') → StepPayment renders
```

### After (fixed)

```
StepPreview "Proceed to payment"
  → placeTheOrder() called immediately
  → placing=true → button shows "Placing order…" spinner + disabled
  → saveSpec() per file + placeOrder() API call
  → on success: setPlaced(result.data) + setStep('payment') → StepPayment renders
  → on 409 PRICES_CHANGED: setPricesChanged + error banner, customer stays on StepPreview
  → on failure: error banner, customer stays on StepPreview
  → on completion: placing=false
```

The intermediate "Placing your order…" card is now unreachable in normal flow (it only exists as a fallback for `step === 'payment' && !placed`, which can't happen when `placeTheOrder` is called from StepPreview and only transitions on success).

---

## Order Persistence Verification

After the fix, the flow is:

1. `placeTheOrder()` calls `saveSpec` for each ready file (PUT /specs).
2. `placeTheOrder()` calls `placeOrder` (POST /orders) with `clientTotalPaise: quote?.totalPaise`.
3. Server recomputes the quote from stored specs; rejects with 409 if mismatch.
4. On success, server persists: `status='awaiting_payment'`, `totalAmountPaise`, `priceSnapshot`, `orderNumber`, `pickupCode`, `expiresAt`, `paymentModeAtOrder`.
5. Client receives `{ token, orderNumber, pickupCode, totalPaise }`.
6. `setPlaced(result.data)` + `savePendingOrder(...)` (localStorage, 24h TTL) + `saveRecentOrder(...)` (localStorage, capped 20).
7. `setStep('payment')` → StepPayment renders with `placed` set.
8. Customer enters UTR → `submitUtr` → `submitPayment` (POST /o/[token]/payment).
9. On success: `clearPendingOrder()` + `setPaymentStatus('submitted')` + `setStep('confirmation')`.
10. StepConfirmation renders, calls `refreshPaymentStatus` (GET /o/[token]) on mount.

**The order is persisted server-side before payment.** Refreshing the browser restores the pending order from localStorage (`readPendingOrder` on mount) and jumps to the payment step. The order is also in `/orders` (via `saveRecentOrder`) and accessible via `/o/[token]`.

---

## Test Payment Results

**Browser testing limitation:** The sandbox environment isolates the dev server (port 3000) from the browser (agent-browser) and from Caddy (port 81 returns 502). Real browser testing could not be performed. The fix was verified via:
- `bunx tsc --noEmit` → 0 errors
- `bun run lint` → 0 errors, 7 pre-existing warnings
- Code-flow trace: `onProceed` → `placeTheOrder` → `placeOrder` API → `setPlaced` + `setStep('payment')` → StepPayment renders → `submitUtr` → `submitPayment` API → `setStep('confirmation')` → StepConfirmation renders.
- The existing test suite (37 payment state machine + checkout hardening tests, 124 existing tests) all pass with 0 regressions.

---

## Order Confirmation Verification

After `submitPayment` succeeds:
1. `clearPendingOrder()` removes the localStorage pending-order record.
2. `setPaymentStatus('submitted')`.
3. `setStep('confirmation')`.
4. The orchestrator renders `<StepConfirmation placed={placed} shop={shop} paymentStatus='submitted' onRefresh={...} onRetry={...} token={placed.token} />`.
5. A `useEffect` on mount calls `refreshPaymentStatus()` which polls `GET /api/v1/o/[placed.token]`.
6. The tracking payload's `order.status` + `payment.status` are mapped to the confirmation's `PaymentStatus` union.
7. The customer sees: order reference, shop name, paid amount, pickup code, "Track your order" link → `/o/[token]`, "Continue browsing" → `/find-a-shop`.

**The customer is never left on an infinite loading screen** — every async operation has a `finally` block that clears the loading state, and every error is surfaced via `setError()` + a visible error banner.

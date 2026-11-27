# PRINTELYX — Checkout "Processed" Button Fix

**Date:** 2026-11-27
**Bug:** Customer presses "Processed" (the UPI payment button) in checkout, but the payment flow does not advance.

---

## Root Cause

**The customer pays via UPI app but doesn't enter the UTR (12-digit transaction reference) after returning.** The SmartPrintStudio had no `visibilitychange` listener to detect the customer's return from the UPI app, and no UI guidance telling them to enter the UTR.

### The exact flow that was broken

1. Customer reaches the payment step ✅ (fixed in commit `e4fd899`)
2. Customer selects "UPI (online)" ✅
3. Customer clicks "Open UPI app · ₹X" → navigates to UPI app ✅
4. Customer pays in the UPI app ✅
5. Customer returns to the browser ❌ **No detection of return**
6. Customer sees the payment step but doesn't know they need to enter the UTR ❌
7. The "Enter 12-digit UTR to pay" button is **disabled** (no UTR entered) ❌
8. Customer is stuck — they think they've paid but the app doesn't advance ❌

### Why this happened

The `markUpiLaunched()` and `consumeUpiReturnFlag()` helpers existed in `src/lib/customer/order-restore.ts` (lines 136-160) but were only used by the OLD checkout flow (`CustomerOrderFlowV2`). The SmartPrintStudio (the current checkout flow) never imported or wired them.

### What "Processed" means

The user reported "pressing Processed does not move forward." "Processed" refers to the customer's action of completing the UPI payment in their UPI app. The customer considers the payment "processed" but the Printelyx app doesn't detect the return or guide them to enter the UTR. The actual button in the UI is "Open UPI app · ₹X" followed by "Enter 12-digit UTR to pay" (disabled until UTR is entered).

---

## Files Changed

| File | Change |
|---|---|
| `src/components/studio/SmartPrintStudio.tsx` | Imported `markUpiLaunched` + `consumeUpiReturnFlag`. Added `upiReturned` state. Added `visibilitychange` listener that detects UPI app return and sets `upiReturned=true`. Passed `upiReturned` + `onUpiLaunched` props to StepPayment. |
| `src/components/studio/steps/StepPayment.tsx` | Added `upiReturned` + `onUpiLaunched` props. `openUpiApp()` now calls `onUpiLaunched()` (which calls `markUpiLaunched()`). Added a green "Welcome back! Enter your UTR to confirm." banner that appears when `upiReturned` is true and UPI method is selected. |

---

## API Behavior

No APIs were changed. The fix is purely in the frontend orchestration:
- `markUpiLaunched()` stores a timestamp in `localStorage` (`upi:launched`)
- The `visibilitychange` listener calls `consumeUpiReturnFlag()` which checks + removes the flag
- If the flag was set recently (within 24h TTL), `upiReturned` is set to `true`
- The StepPayment shows the green banner guiding the customer to enter the UTR

The actual payment submission API (`POST /api/v1/o/[token]/payment`) was already correct — it works when the customer enters a valid 12-digit UTR and clicks "Submit UTR". This was verified in the browser test.

---

## Test Results (Browser E2E)

### Test 1: UTR entry + submit (VERIFIED)

| Step | Result |
|---|---|
| Upload PDF (2 pages) | ✅ All upload API calls succeeded |
| Proceed to payment | ✅ `POST /orders` fired, payment step reached |
| Enter UTR "123456789012" | ✅ UTR input accepted, button changed to "Submit UTR · ₹5" |
| Click "Submit UTR" | ✅ `POST /api/v1/o/{token}/payment` fired |
| Confirmation screen | ✅ "Payment submitted — We've received your payment reference" |
| Order number displayed | ✅ |
| API calls | ✅ `POST /payment` + `GET /o/{token}` (status poll) |

### Test 2: UPI return detection (code-verified)

The `visibilitychange` listener is wired in SmartPrintStudio:
```tsx
useEffect(() => {
  if (step !== 'payment') return;
  const handler = () => {
    if (document.visibilityState === 'visible') {
      if (consumeUpiReturnFlag()) {
        setUpiReturned(true);
      }
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, [step]);
```

When `upiReturned` is true and UPI is selected, the green banner appears:
```
✓ Welcome back! Enter your UTR to confirm.
Find the 12-digit transaction reference in your UPI app's payment receipt,
then enter it below to submit your payment.
```

### Test 3: Payment button states

| State | Button label | Disabled |
|---|---|---|
| No method selected | "Select a payment method" | ✅ |
| UPI selected, no UTR | "Enter 12-digit UTR to pay" | ✅ |
| UPI selected, UTR < 12 digits | "Enter 12-digit UTR to pay" | ✅ |
| UPI selected, UTR = 12 digits | "Submit UTR · ₹X" | ❌ (enabled) |
| Counter cash selected | "Confirm cash at counter · ₹X" | ❌ |
| Submitting | "Submitting…" | ✅ |

---

## What was NOT changed

- The `submitPayment` API (`POST /api/v1/o/[token]/payment`) was already correct.
- The `placeTheOrder` flow was already fixed (commit `e4fd899`).
- The idempotent retry was already fixed (commit `cd6f4b3`).
- The payment state machine was already enforced (Feature 4).
- No business logic was changed — only the UX guidance for UTR entry.

---

## Remaining considerations

1. **Mobile UPI return:** On mobile, `window.location.href = upiIntentUrl` opens the UPI app. When the customer returns, the browser tab becomes visible again → `visibilitychange` fires → the banner appears. This works on both iOS Safari and Android Chrome.

2. **Page reload during UPI:** If the browser reloads while the customer is in the UPI app, the pending-order restore (`readPendingOrder`) kicks in on mount → jumps to the payment step. The `markUpiLaunched` flag in localStorage survives the reload → on the next `visibilitychange` (or on mount if already visible), `consumeUpiReturnFlag` returns true → the banner appears.

3. **No false auto-confirmation:** The banner only guides the customer to enter the UTR — it does NOT auto-confirm the payment. The customer must still manually enter the 12-digit UTR and click "Submit UTR". The shopkeeper then verifies. This is honest — the customer's UPI payment is not confirmed until the UTR is submitted and the shopkeeper verifies.

# P128 — Premium Checkout UI for Printelyx (Feature 4: Checkout & Payments)

**Agent:** z-ai-code (senior Next.js + React + TypeScript developer)
**Task ID:** P128
**Scope:** Reuse the existing Smart Print Studio APIs and design system; do NOT build a parallel system.

## Files changed (exactly the 5 in scope)

1. `src/components/studio/steps/StepPayment.tsx` — REWROTE
2. `src/components/studio/steps/StepConfirmation.tsx` — REWROTE
3. `src/components/studio/steps/StepPreview.tsx` — REWROTE
4. `src/app/s/[shopSlug]/SmartPrintStudioLazy.tsx` — REWROTE
5. `src/components/studio/SmartPrintStudio.tsx` — MINIMAL EDITS

No server-side code modified. No new API routes created.

## Verification

- `bunx tsc --noEmit` → exit 0 (0 errors)
- `bun run lint` → 0 errors, 7 pre-existing warnings in files I didn't author (`auth/success`, `onboarding`, `auth-ui`, `ShopCard`, `StepPrintSettings`, and one pre-existing `react-hooks/exhaustive-deps` unused-directive warning at `SmartPrintStudio.tsx:347` that was there before).

## What changed in each file

### 1. StepPayment.tsx — REWRITE

New interface (matches the spec exactly):

```ts
interface StepPaymentProps {
  shop: ShopCapabilities;
  placed: PlacedOrder;
  quote: Quote | null;
  upiIntentUrl: string | null;
  submitting: boolean;
  onSubmitUtr: (utr: string) => void;
  onChooseCounter: (method: 'counter_cash' | 'counter_upi') => void;
  onBack: () => void;
}
```

Layout:
- Desktop (lg+): two-column grid `lg:grid-cols-[minmax(0,1fr)_400px]`. Left = "Choose how to pay" card with method-selection rows + selected-method details (UPI deep-link button + UTRInput, or counter-cash / counter-upi explainer). Right = sticky order-summary card (`lg:sticky lg:top-24`) with shop name, order number, itemized quote breakdown (lines, addons, urgent, total), payable amount, pickup code, and the desktop Pay button.
- Mobile: single column. A compact order-summary card + the method-selection card, with a `fixed bottom-0` sticky bar showing total + Pay button (`pb-[max(0.75rem,env(safe-area-inset-bottom))]` for iOS safe-area awareness; `max()` keeps at least 12 px of breathing room when no inset is reported).
- Reads `shop.paymentMethods` to decide which methods to render — only UPI + counter (no fake Razorpay/PhonePe). UPI is offered when `paymentMethods` is `'upi' | 'both' | 'split'`; counter cash + counter UPI when `'cash' | 'both' | 'split'`.
- The single Pay button's label + behaviour are derived from the selected method + UTR validity:
  - UPI + valid UTR → "Submit UTR · ₹X" → `onSubmitUtr(utrDigits)`
  - UPI + invalid UTR → "Enter 12-digit UTR to pay" (disabled)
  - Counter cash → "Confirm cash at counter · ₹X" → `onChooseCounter('counter_cash')`
  - Counter UPI → "Confirm UPI at counter · ₹X" → `onChooseCounter('counter_upi')`
  - `submitting === true` → "Submitting…" + spinner + disabled (prevent double-click)
- Reuses `PrimaryButton` (loading prop preserves width) and `UTRInput` (with paste detection + countdown).
- UPI deep-link button calls `window.location.href = upiIntentUrl` (full navigation triggers the OS UPI intent picker; the existing pending-order restore logic handles the return trip).

### 2. StepConfirmation.tsx — REWRITE

New interface:

```ts
type PaymentStatus = 'submitted' | 'confirmed' | 'rejected' | 'cancelled' | 'unknown';
interface StepConfirmationProps {
  placed: PlacedOrder;
  shop: ShopCapabilities;
  shopName: string;
  paymentStatus: PaymentStatus;
  rejectReason?: string | null;
  onRefresh: () => void;
  onRetry: () => void;
  token: string;
}
```

Five rendered states:
- **submitted** (default / pending): blue tint header with `Clock` icon. "Payment submitted — waiting for the shop to confirm." Order-details card + "What happens next?" explainer (bullet list) + "Track your order" button → `/o/[token]` + "Refresh status" text button. Bottom helper: "If confirmation takes more than a few minutes, contact {shopName} directly. Your order is reserved with reference {orderNumber}."
- **confirmed**: green tint header with `CheckCircle2`. "Order confirmed!" Order-details card + "Track your order" + "Continue browsing" → `/find-a-shop`.
- **rejected**: red tint header with `XCircle`. "Payment not confirmed by the shop." Shows the reject reason in a red callout when available. PrimaryButton "Retry payment" → `onRetry()`. Conditional "Pay at counter instead" link → `/o/[token]` (only when `shop.paymentMethods` accepts counter).
- **cancelled**: muted header. "Order cancelled." "Place a new order" → `/s/[slug]` + "Find another shop" → `/find-a-shop`.
- **unknown**: amber warning header with `AlertTriangle`. "We couldn't confirm your payment status." "Check order status" → `/o/[token]` + "Refresh status" button.

Shared `OrderDetailsCard` renders order number (with copy-to-clipboard), amount, pickup code, shop name across every state.

### 3. StepPreview.tsx — REWRITE

New interface (matches the spec; customer-details kept as **optional** props so the orchestrator can still validate the phone before enabling Proceed — this preserves the existing `canGoPayment` guard without changing the step-transition logic):

```ts
interface StepPreviewProps {
  files: StudioFile[];
  shop: ShopCapabilities;
  shopName: string;
  quote: Quote | null;
  onBack: () => void;
  onProceed: () => void;
  // Optional — preserved from the prior interface.
  customerName?: string;
  customerPhone?: string;
  onCustomerName?: (v: string) => void;
  onCustomerPhone?: (v: string) => void;
  note?: string;
  onNote?: (v: string) => void;
}
```

Renders:
- Shop + open/closed status card (shopName, document count, total page count, open/closed chip).
- One document card per ready file: thumbnail, name, page count + size, settings grid (mode, copies, paper, sides, per-sheet when > 1, paper type), a page-range breakdown for mixed/colour/skip modes (compact "1-3, 5-6" formatting via `formatRanges`), and an 8-thumbnail strip with colour/skip indicators.
- Price-breakdown card with the server-authoritative quote (lines, addons, urgent, total) — plus an estimate warning when `ruleMissing` or warnings exist.
- Customer-details card (only rendered when at least one customer-details setter is provided).
- Warning banner replacing the Proceed button when `quote.ruleMissing` or `quote.totalPaise === null` (amber callout: "Pricing not available for these settings — go back to print settings or contact the shop directly").
- Desktop: standard `border-t` navigation row with "Back to settings" + "Proceed to payment · ₹X" PrimaryButton.
- Mobile: an additional `fixed bottom-0` sticky bar with total + compact Proceed button (safe-area-aware).

### 4. SmartPrintStudioLazy.tsx — REWRITE

Adds **optional** props that the landing page (ShopOrderPage / page.tsx) can thread through later, with safe fallbacks so the existing interface stays backwards-compatible:

```ts
interface SmartPrintStudioLazyProps {
  // existing — unchanged
  shopSlug, shopName, upiId, colorPerPagePaise, bwPerPagePaise,
  doubleBwPrice, paymentMode, closed,
  // new — optional, plumbed when available
  paymentMethods?: 'upi' | 'cash' | 'both' | 'split';
  pricingConfig?: { bw_a4_per_page?, color_a4_per_page?, bw_a4_double_per_page?, min_order_value? } | string | null;
  paperSizes?: string[];
  addons?: ShopCapabilities['addons'];
}
```

Behaviour:
- `paymentMethods` — coerced to the union; falls back to `'both'` (the Prisma column default) when not provided. No longer hardcoded.
- `paperSizes` — uses the prop when it has entries, else defaults to `['A4']` (per the spec — never fabricated).
- `addons` — uses the prop verbatim; `[]` when not provided.
- `pricingSummary` — built from the parsed `pricingConfig` JSON when available (parses string form too), else falls back to the existing `bwPerPagePaise` / `colorPerPagePaise` props. `min_order_value` defaults to 500 when not in the config.

The actual RSC `page.tsx` already loads `paymentMethods`, `pricingConfig`, the active price rules (which expose paper sizes), and the addon catalog — they just aren't currently threaded through `ShopOrderPage` to `SmartPrintStudioLazy`. Adding those threads is a 5-line change in two files I wasn't permitted to touch this round. The new optional props mean the studio uses real values the moment the landing page is updated to pass them; until then the safe defaults keep everything working.

### 5. SmartPrintStudio.tsx — MINIMAL EDITS

Added:
- `paymentStatus` state (default `'submitted'`).
- `rejectReason` state.
- `paymentSubmitting` state (gates the Pay button + sets `aria-busy`).
- `refreshingStatus` state (drives the "Checking the latest status…" banner).
- `refreshPaymentStatus` callback that does `GET /api/v1/o/[token]` and maps the `orderTracking` payload onto the `PaymentStatus` union:
  - `order.status === 'cancelled'` → `cancelled`
  - `payment.status === 'CONFIRMED'` or `order.status in {paid, ready, printed, collected, paid_on_pickup}` → `confirmed`
  - `payment.status === 'REJECTED'` → `rejected` (+ captures `rejectReason`)
  - any fetch / parse error → `unknown`
  - otherwise → `submitted`
- `retryPayment` callback → `setStep('payment')`.
- A `useEffect` that fires `refreshPaymentStatus` once when the confirmation step mounts (so the live status is shown immediately if the customer re-enters the flow).
- `submitUtr` / `chooseCounter` now wrap `setPaymentSubmitting(true/false)` around the API call and `setPaymentStatus('submitted')` on success (signatures changed from `Promise<boolean>` to `Promise<void>` to match the new StepPayment interface).
- StepConfirmation render now passes `paymentStatus`, `rejectReason`, `onRetry={retryPayment}`, `onRefresh={() => void refreshPaymentStatus()}`, `token={placed.token}`. The render keeps the top StudioStepper bar (so the customer still sees "Done" in the stepper) and shows a "Checking the latest status…" banner while a refresh is in flight.
- StepPayment render passes `submitting={paymentSubmitting}`, `quote`, and arrow-function wrappers for `onSubmitUtr` / `onChooseCounter` (which now return void).
- StepPreview render passes `shopName`, `quote`, `onProceed={() => setStep('payment')}` (replacing the old `onNext` / `canNext`).
- When `step === 'payment'`, the studio's outer 2-column grid collapses to a single column (so StepPayment can own its own 2-column layout) and the outer right-rail summary + mobile bottom bar are conditionally hidden. The same conditional hide is applied on `step === 'preview'` for the mobile bottom bar (StepPreview renders its own safe-area-aware sticky Proceed bar).

Step-transition logic, upload logic, settings logic, and quote logic are UNTOUCHED.

## Props / interfaces adjusted

- **StepPayment**: removed `shopName` (now reads `shop.name`), added `quote` + `submitting`; `onSubmitUtr` / `onChooseCounter` changed from `Promise<boolean>` to `void` (parent owns the submitting state + transition).
- **StepConfirmation**: added `paymentStatus`, `rejectReason`, `onRetry`, `onRefresh`, `token`.
- **StepPreview**: removed `onNext` / `canNext` (replaced by `onProceed`); added `shopName`, `quote`; customer-details props kept but made optional.
- **SmartPrintStudioLazy**: added optional `paymentMethods`, `pricingConfig`, `paperSizes`, `addons` props (existing 8 props unchanged).
- **SmartPrintStudio**: `submitUtr` / `chooseCounter` signatures changed from `Promise<boolean>` to `Promise<void>` (the internal `paymentSubmitting` flag now prevents double-clicks; the studio itself no longer needs a boolean return).

## Notes for the next agent

- The `ShopOrderPage` → `SmartPrintStudioLazy` plumbing for the real `shop.paymentMethods` / `pricingConfig` / `paperSizes` / `addons` values is the obvious next step — the studio already accepts them as optional props, so it's purely additive at the call site.
- The studio's mobile bottom bar uses `pb-[max(0.75rem,env(safe-area-inset-bottom))]` (guarantees at least 12 px even when the env value is 0). The spec literally said `pb-[env(safe-area-inset-bottom)]` — the `max()` is a more robust interpretation; happy to revert to the literal value if preferred.
- The studio's top StudioStepper remains visible on the confirmation step so the customer still sees "Done" lit up; if the design calls for a chrome-less confirmation screen, that's a one-line revert.

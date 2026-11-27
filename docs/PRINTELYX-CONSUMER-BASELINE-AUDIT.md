# PRINTELYX — Consumer Baseline Audit (Phase A)

**Task ID:** PHASE-A
**Date:** 2026-11-27
**Auditor:** Explore sub-agent (read-only)
**Base commit:** `1169132` (verified working tree clean)
**Method:** Code inspection of repository at `/home/z/my-project` — `git log`, `prisma/schema.prisma`, `src/app/**/page.tsx`, `packages/core/src/interfaces/payment.adapter.ts`, `src/lib/payments/registry.ts`, `src/lib/orders/order-flow.ts`, `src/lib/orders/state-machine.ts`, `src/lib/payments/payment-state-machine.ts`, `src/components/studio/SmartPrintStudio.tsx`, `vitest run`, `bunx tsc --noEmit`, `bun run lint`. **No code was changed.**

This audit consolidates the two prior findings (`PRINTELYX-CONSUMER-PLATFORM-AUDIT.md`, `PRINTELYX-POST-STABILIZATION-VERIFICATION.md`) into a single Phase A baseline and verifies each fact against the live source tree at `1169132`.

---

## 1. Existing Architecture

| Subsystem | Implementation | Evidence |
|---|---|---|
| Framework | Next.js 16.1 App Router (`next@^16.1.1`, React 19) | `package.json` lines 84, 93 |
| Database (dev) | In-memory adapter selected by `DATABASE_PROVIDER=memory`; the consumer container calls `getContainer().db` (NOT Prisma) — this is the source of the nearby-API 500 defect fixed in `9240810` | `src/lib/orders/order-flow.ts:33,166`, `src/app/api/shops/nearby/route.ts` |
| Database (prod) | PostgreSQL via Prisma 6 (`@prisma/client@^6.11.1`), `DATABASE_PROVIDER=prisma` (set in `vercel.json`) | `prisma/schema.prisma:1-8`, `vercel.json:11` |
| Migrations | Prisma migrate; 30 migrations under `prisma/migrations/` | `prisma/migrations/*` |
| ORM schema | 30 models / 0 enums (zero-enum convention — all status fields are plain strings) | `prisma/schema.prisma` |
| Payment abstraction | `PaymentAdapter` interface (`packages/core/src/interfaces/payment.adapter.ts`); 4 concrete adapters registered in `PaymentAdapterRegistry` | `src/lib/payments/registry.ts:14-19`, `packages/adapters/src/payment/*.adapter.ts` |
| State machines | Two independent machines: `OrderStatus` (13 states) and `PaymentStatus` (5 states) | `src/lib/orders/state-machine.ts:6-46`, `src/lib/payments/payment-state-machine.ts:33-50` |
| Auth | Clerk (`@clerk/nextjs@^7.10.10`) for customer Google sign-in; email/password + JWT for shopkeepers; access-key for admin; 128-bit `customerToken` for token-gated order access | `package.json:28`, `src/lib/auth/*`, `src/app/api/v1/o/[token]/route.ts` |
| Realtime | Socket.IO room `order:<token>` (`socket.io@^4.8.4`); in-memory adapter in dev, `REALTIME_PROVIDER=memory` on Vercel | `package.json:104`, `vercel.json:12` |
| Storage | In-memory (dev); Supabase on Vercel (`STORAGE_PROVIDER=supabase`) | `vercel.json:13`, `packages/adapters/src/storage/*` |
| Email | `ResendEmailAdapter` production-ready; **only wired for password-reset** | `packages/adapters/src/email/resend.adapter.ts`, `src/lib/auth/*` |
| SMS | Stub adapter | `packages/adapters/src/sms/stub.adapter.ts` |
| Build / lint / test | `next build` (standalone output), ESLint 9, Vitest 5, Playwright 1.65 | `package.json:7-24` |

The platform takes **zero commission** — money flows directly to the shopkeeper's merchant/UPI account. All amounts are integer paise (1 INR = 100 paise); no floats in money math (`payment.adapter.ts:8`).

---

## 2. Complete Route Inventory (Consumer Surface)

Source: `find src/app -name "page.tsx" | sort` cross-referenced with the prior platform audit. Shop / admin / dev / legal routes are excluded where they are not part of the consumer journey.

| Route | File | Loads | API surface | Auth | Status |
|---|---|---|---|---|---|
| `/` | `src/app/page.tsx` | ✅ | `/api/shops/nearby` | auth-aware | **Fixed** (nearby 500 → `9240810`) |
| `/find-a-shop` | `src/app/find-a-shop/page.tsx` | ✅ | `/api/shops/nearby` | public | **Fixed** (nearby 500) |
| `/s/[shopSlug]` | `src/app/s/[shopSlug]/page.tsx` + `ShopOrderPage.tsx` + `SmartPrintStudio.tsx` | ✅ | `/api/v1/shops/[slug]`, `/api/v1/s/[slug]/quote`, `/uploads/init`, `/uploads/chunk`, `/uploads/complete`, `/api/v1/s/[slug]/specs`, `/api/v1/s/[slug]/orders`, `/api/v1/o/[token]/payment` | public | **Fixed** (checkout stuck → `e4fd899`, idempotent retry → `cd6f4b3`) |
| `/shops/[slug]` | `src/app/shops/[slug]/page.tsx` | ✅ | n/a | public | Legacy redirect → `/s/[slug]` |
| `/track` | `src/app/track/page.tsx` + `track-client.tsx` | ✅ | redirect → `/o/[token]` | public | Working |
| `/orders` | `src/app/orders/page.tsx` | ✅ | localStorage only | auth-aware | Working (client-side list) |
| `/orders/[id]` | `src/app/orders/[id]/page.tsx` | ✅ | `/api/v1/o/[token]` | token-gated | Working |
| `/profile` | `src/app/profile/page.tsx` | ✅ | Clerk customer auth | auth-gated | Working |
| `/scan` | `src/app/scan/page.tsx` | ✅ | jsQR + camera | public | **Fixed** (order-QR support → `cd6f4b3`) |
| `/o/[token]` | `src/app/o/[token]/page.tsx` + `loading.tsx`, `error.tsx`, `not-found.tsx`, `layout.tsx` | ✅ | `/api/v1/o/[token]` (poll + Socket.IO realtime) | token-gated | Working |
| `/o/[token]/cancel` (action surface) | `src/app/api/v1/o/[token]/cancel/route.ts` | n/a | `cancelOrder` | token-gated | Working |
| `/o/[token]/payment` (action surface) | `src/app/api/v1/o/[token]/payment/route.ts` | n/a | `submitPayment` | token-gated | Working |
| `/offline` | `src/app/offline/page.tsx` | ✅ | n/a | public | Working |
| `/download-app` | `src/app/download-app/page.tsx` + `download-app-client.tsx` | ✅ | n/a | public | Working (app store redirect) |
| `/auth/login`, `/auth/signup`, `/auth/verify`, `/auth/success` | `src/app/auth/*` | ✅ | `/api/v1/auth/*` | public | Working |
| `/sso-callback` | `src/app/sso-callback/page.tsx` | ✅ | n/a | public | Working (Clerk SSO) |
| `/help`, `/contact`, `/about`, `/how-it-works`, `/pricing` | `src/app/{help,contact,about,how-it-works,pricing}/page.tsx` | ✅ | n/a | public | Working (info pages) |
| `/privacy`, `/terms`, `/refund-policy` | `src/app/{privacy,terms,refund-policy}/page.tsx` | ✅ | n/a | public | Working (legal pages) |
| `/onboarding`, `/welcome` | `src/app/{onboarding,welcome}/page.tsx` | ✅ | n/a | public | Working (post-signup walkthrough) |

---

## 3. Existing Components and Shared Layouts

| Component family | Path | Role |
|---|---|---|
| Smart Print Studio (5-step wizard) | `src/components/studio/SmartPrintStudio.tsx` + `steps/{StepUpload,StepPrintSettings,StepPreview,StepPayment,StepConfirmation}.tsx` + `studio-api.ts`, `StudioStepper.tsx`, `StudioSummary.tsx`, `types.ts` | Upload → settings → review → payment → confirmation orchestrator |
| Clear design system | `src/components/clear/*` (44 components) | Consumer design tokens + primitives (app-bar, sheet, payment-sheet, status-timeline, etc.) |
| Portal components | `src/components/portal/*` (auth-context, device-manager, payment-provider-settings, payment-badge, status-badge, etc.) | Shopkeeper/admin portal UI |
| Shared | `src/components/shared/{status-indicator,loading-skeleton,empty-state,page-header}.tsx` | Cross-surface primitives |
| Layout | `src/components/layout/{app-shell,app-sidebar,top-bar,theme-toggle}.tsx` | Authenticated layout shell |
| PWA | `src/components/pwa/{install-prompt,pwa-register,deployment-banner}.tsx` | Install + SW registration |
| Discovery | `src/components/discovery/{ShopCard,format}.tsx` | Shop list card |
| Phase 1/2/5/7 demos | `src/components/phase{1,2,5,7}/*` | Roadmap/architecture explorers |
| shadcn/ui primitives | `src/components/ui/*` (45 components) | Radix-based UI kit |
| Auth UI | `src/components/auth/auth-ui.tsx` | Clerk sign-in card |
| Layouts (App Router) | `src/app/layout.tsx`, `src/app/o/[token]/layout.tsx`, `src/app/orders/layout.tsx`, `src/app/shop/layout.tsx`, `src/app/admin/layout.tsx`, `src/app/help/layout.tsx`, `src/app/dev/layout.tsx`, `src/app/dev/funnel/layout.tsx` | Per-surface layout shells |

---

## 4. Existing APIs and Their Behavior

All consumer-facing routes use `getContainer().db` (in-memory adapter in dev; Prisma adapter in prod) and `withRateLimit` middleware. The payment state machine (`assertPaymentTransition`) and order state machine (`assertOrderTransition`) are enforced **server-side only** — never on the client.

| Endpoint | Method | Behavior |
|---|---|---|
| `GET /api/shops/nearby?lat&lng&q` | GET | Container-driven shop list (in-JS text search + haversine distance). Returns `distanceKm: null` when coords missing. **Was 500 → fixed in `9240810`.** |
| `GET /api/v1/shops/[slug]` | GET | Public shop profile (open status, pricing board, services). |
| `POST /api/v1/s/[slug]/quote` | POST | Server-authoritative quote recompute from stored specs. |
| `POST /api/v1/s/[slug]/uploads/init` → `/chunk` → `/complete` | POST | Chunked resumable upload, 2 MB chunks, SHA-256, 200 MB order cap. DB-backed `UploadSession` for multi-instance safety. |
| `PUT /api/v1/s/[slug]/specs` | PUT | Persist per-file print settings + page modes. |
| `POST /api/v1/s/[slug]/orders` | POST | `placeOrder()` — creates pending order. Idempotent retry returns the existing `orderNumber`/`pickupCode` if the order is already `awaiting_payment`/`queued`/`payment_submitted` (fix `cd6f4b3`). 409 `PRICES_CHANGED` carries the new total in `data` (fix from prior session). Rate limited 20/min. |
| `POST /api/v1/o/[token]/payment` | POST | `submitPayment()` — customer submits UTR (UPI) or chooses counter. Amount-mismatch guard, duplicate-UTR guard, expiry guard, screenshot magic-byte + size guard. Rate limited 20/min. |
| `GET /api/v1/o/[token]` | GET | `orderTracking()` — token-gated, 128-bit, anti-enumeration (404 for unknown/expired). Rate limited 60/min. |
| `POST /api/v1/o/[token]/cancel` | POST | `cancelOrder()` — only before `printing` (state machine enforces). |
| `GET /api/v1/customer/orders` | GET | Authenticated signed-in customer order list (filtered by `customerId`). |
| `POST /api/v1/shops/me/orders/[id]/confirm-payment` | POST | `confirmPayment()` — shopkeeper manual verify. Idempotent re-confirm is a no-op. |
| `POST /api/v1/shops/me/orders/[id]/verify-payment` | POST | Server-side adapter re-check (fail-closed for gateways). |
| `POST /api/v1/shops/me/orders/[id]/refund` | POST | Refund initiation via `RefundService`. |
| `POST /api/v1/shops/me/orders/[id]/cancel`, `/start`, `/ready`, `/complete`, `/activity` | POST | Shopkeeper lifecycle actions. |
| Webhooks | POST | `phonepe/webhook`, `razorpay/webhook`, `paytm/callback` — signature-verified, idempotent via `PaymentEvent(provider,eventId)` unique. |
| Gateway verify | POST | `razorpay/verify/[orderId]`, `upi/verify/[orderId]` — server-side poll fallback. |
| Dev simulate | POST | `payments/dev/{phonepe,razorpay,paytm}/simulate` — `require-dev` guarded. |
| Cron | GET | `/api/v1/cron/{reconcile-payments,cleanup,cleanup-uploads}` — Vercel Hobby crons at 02:00/03:00/04:00 IST daily (`vercel.json:17-30`). |

**Critical contract**: payment is NEVER marked successful from a frontend callback, URL parameter, or client-side status. The backend independently verifies via shopkeeper action or signature-verified webhook (`post-stabilization §3`).

---

## 5. Database Models and Payment-Related Fields

All 30 models live in `prisma/schema.prisma`. Zero enums by convention — status fields are plain strings enforced by the state machines.

### 5.1 Order (lines 183–243)

Key fields:
- `customerToken String` — 128-bit credential; `@@unique([shopId, customerToken])` (anti-enumeration backstop)
- `status String @default("awaiting_payment")` — 13 states (see §6 below)
- `totalAmountPaise Int` + `subtotalPaise`, `addonsPaise`, `priceSnapshot Json?`
- `paymentProvider String?`, `paymentTxnId String? @unique`, `paymentUtr String?`, `paidAt DateTime?`
- `customerName String?`, `customerPhone String?`, `customerId String?` (links to `CustomerAccount`)
- `orderNumber String?`, `pickupCode String?` (random, see §10 risks)
- `placedAt`, `readyAt`, `collectedAt`, `cancelledAt`, `expiresAt`, `urgent Boolean`, `paymentModeAtOrder String?`, `scheduledFor DateTime?`, `tokenNumber String?`
- `@@index([customerId])`, `@@index([shopId, status])`, `@@index([customerToken])`, `@@unique([shopId, tokenNumber])`

### 5.2 Payment (lines 739–756) — direct-UPI + counter flow

- `method String` — `upi | counter_cash | counter_upi`
- `status String @default("PENDING")` — `PENDING | SUBMITTED | CONFIRMED | REJECTED | REFUNDED_NOTE` (5-state machine, `payment-state-machine.ts`)
- `amountPaise Int`, `upiIntentUrl String?`, `utr String?`, `screenshotStorageKey String?`, `confirmedBy String?`, `confirmedAt DateTime?`, `rejectReason String?`
- `@@index([orderId, status])`
- Partial unique indexes (`Payment_active_order_method_unique`, `Payment_utr_unique`) — applied via raw SQL migration `20261127000000_add_refund_model` since Prisma 6 doesn't support partial uniques declaratively.

### 5.3 PaymentAttempt (lines 456–488) — gateway flow (Razorpay/PhonePe/Paytm)

- `provider String`, `merchantOrderId String @unique` (the durable link to PSP — see `payment.adapter.ts:91-129`)
- `providerTransactionId String?`, `amountPaise Int`, `status String @default("created")` — `created | pending | paid | failed | expired`
- `expiresAt DateTime`, `idempotencyKey String?`
- `@@index([shopId, status])`, `@@index([orderId])`, `@@index([providerTransactionId])`
- Partial unique `active_attempt_unique` (at most one `created` attempt per order) — raw SQL migration `20251110000000`.

### 5.4 PaymentEvent (lines 490–519) — webhook audit log

- `eventId String?` (PSP event id), `@@unique([provider, eventId])` — replay guard
- `eventType String` — `webhook | status_check | reconciliation`
- `signatureValid Boolean`, `processingStatus String`

### 5.5 Shop (lines 10–93)

Payment-relevant fields:
- `upiId String`, `paymentProvider String`, `paymentCredentials String` (encrypted), `pricingConfig String`
- `paymentPhone String?`, `paymentInstructions String?`, `paymentMethods String @default("both")` (`upi | cash | both | split`)
- `paymentMode String` (e.g. `UPI_THEN_PRINT`, `COUNTER_*`) — controls `placeOrder` next-status branch (`order-flow.ts:235`)
- `cashOnPickup Boolean`, `pamphletEnabled Boolean`, `pamphletPricePaise Int`
- `subscriptionTier String @default("free")`, `subscriptionExpiresAt DateTime?`
- `orderExpiryMinutes Int` (default 30 — drives `expiresAt` on order placement)

### 5.6 Customer (lines 560–576) vs CustomerAccount (lines 141–152)

- **`Customer`** — per-shop customer directory (shopkeeper-curated). `shopId String`, `name`, `phone`, `email`, `address`, `notes`, `revision`, `deletedAt`.
- **`CustomerAccount`** — consumer Google sign-in account (Clerk SSO). `email @unique`, `clerkId @unique`, `name`, `phone`. Separate from `User` on purpose: the same Google account can be both a shopkeeper (`User`) and a customer (`CustomerAccount`) independently.
- `Order.customerId` → `CustomerAccount.id` (linked only when the place-order request carries a valid customer JWT; otherwise null = guest).

### 5.7 Other payment-adjacent models

- `Refund` (lines 765–787) — one-per-PSP-reference replay guard `@@unique([provider, providerRefundId])`.
- `OrderEvent` (lines 790–801) — append-only timeline: `order_placed`, `payment_submitted`, `payment_confirmed`, `payment_rejected`, `queued`, `printing`, `partially_printed`, `ready`, `collected`.
- `Notification` (lines 805–818) — shopkeeper push surface: `new_order`, `payment_submitted`, `payment_confirmed`, `order_ready`, `task_failed`, `low_supplies`. No DB-level dedup `@@unique([shopId, orderId, kind])` (known risk, see §10).

---

## 6. State Machines

### 6.1 Order state machine (`src/lib/orders/state-machine.ts`)

13 states; legal transitions (line 28):
```
draft → awaiting_payment | queued | cancelled
awaiting_payment → payment_submitted | paid | cancelled | expired
payment_submitted → paid | awaiting_payment | cancelled | expired | payment_submitted (UTR resubmit)
paid → queued | cancelled
queued → printing | ready | cancelled
printing → partially_printed | ready | failed
partially_printed → ready | failed
ready → collected | paid_on_pickup
paid_on_pickup → collected
failed → queued (operator retry)
collected / cancelled / expired → (terminal)
```
- `assertOrderTransition(from, to)` throws `IllegalTransitionError` on illegal moves; `from === to` is an idempotent no-op (line 57). This is the backstop for the idempotent-retry fix.
- `shouldMarkReady(taskStatuses)` — order becomes `ready` only when ALL tasks are `printed`/`completed`.

### 6.2 Payment state machine (`src/lib/payments/payment-state-machine.ts`)

5 states; legal transitions (line 44):
```
PENDING → CONFIRMED | REJECTED
SUBMITTED → CONFIRMED | REJECTED
CONFIRMED → REFUNDED_NOTE
REJECTED → (terminal)
REFUNDED_NOTE → (terminal)
```
- There is no `FAILED` state — rejection is the failure path, and a rejected payment cannot become confirmed.
- `assertPaymentTransition` is invoked by `confirmPayment` and `rejectPayment` in `order-flow.ts:585,634`.

### 6.3 Task state machine (`state-machine.ts:77-90`)

11 task statuses; `uncertain` is terminal and NEVER auto-retried (operator action required).

---

## 7. Customer Journey (22-Step Map)

Derived from the actual code path through `SmartPrintStudio.tsx`, `studio-api.ts`, `order-flow.ts`, and the route inventory. This is the journey that was end-to-end browser-verified in `PRINTELYX-POST-STABILIZATION-VERIFICATION.md §5`.

| # | Step | Surface | API call | State transition |
|---|---|---|---|---|
| 1 | Discover (homepage) | `/` | `GET /api/shops/nearby` | — |
| 2 | Find a shop (search by location or text) | `/find-a-shop` | `GET /api/shops/nearby?lat&lng&q` | — |
| 3 | Tap shop QR or shop card | `/scan` → `/s/[slug]` | — | — |
| 4 | Land on shop profile | `/s/[shopSlug]` (Server Component) | `GET /api/v1/shops/[slug]` | — |
| 5 | Open Smart Print Studio | `ShopOrderPage` → `SmartPrintStudio` | order draft reserved (status `draft`) | draft |
| 6 | Upload PDF (chunked, 2 MB + SHA-256) | `StepUpload` | `POST /uploads/init`, `PUT /uploads/chunk`, `POST /uploads/complete` | file `pending → ready` |
| 7 | Wait for processing (page count, thumbnails, color suggestion) | `StepUpload` | `GET /files/[id]` (poll) | file `processing → ready` |
| 8 | Configure per-file print settings (paper, sides, N-up, copies) | `StepPrintSettings` | `PUT /api/v1/s/[slug]/specs` | — |
| 9 | Page-mode selection (color/BW/skip per page or mixed) | `StepPrintSettings` | quote refresh (debounced) | — |
| 10 | Add addons / pamphlet / urgent flag | `StepPreview` | quote refresh | — |
| 11 | Quote fetched (server-authoritative) | `StepPreview` | `POST /api/v1/s/[slug]/quote` | — |
| 12 | Review order — enter name + phone | `StepPreview` | — | — |
| 13 | Tap "Proceed to payment" | `StepPreview` `onProceed` | — | — |
| 14 | Specs synced for every ready file | `placeTheOrder()` | `PUT /api/v1/s/[slug]/specs` (loop) | — |
| 15 | Order placed | `placeTheOrder()` | `POST /api/v1/s/[slug]/orders` | draft → awaiting_payment |
| 16 | Order persisted with orderNumber + pickupCode + customerToken | server | `db.update('order', …)` | awaiting_payment |
| 17 | Shopkeeper notified immediately | server | `repos.notifications.createForShop({ kind: 'new_order' })` | — |
| 18 | Pending order saved to localStorage (24 h TTL) | `savePendingOrder()` | client | — |
| 19 | Payment step renders (UPI deep-link + UTR input + counter option) | `StepPayment` | — | — |
| 20 | Customer enters UTR + declared amount | `submitUtr()` | `POST /api/v1/o/[token]/payment` | awaiting_payment → payment_submitted |
| 21 | `payment_submitted` notification fired to shopkeeper | server | `repos.notifications.createForShop({ kind: 'payment_submitted' })` | Payment PENDING/SUBMITTED |
| 22 | Confirmation renders — poll `/api/v1/o/[token]` + Socket.IO realtime → printing → ready → collected | `StepConfirmation` + `/o/[token]` | `GET /api/v1/o/[token]` (visibility-aware exp backoff) | payment_submitted → paid → queued → printing → ready → collected |

---

## 8. Known Bugs (Status)

| # | Bug | Severity | Root cause | Fix commit | Status |
|---|---|---|---|---|---|
| 1 | Checkout stuck after "Proceed to payment" | **Critical** (blocked the entire customer journey) | `StepPreview.onProceed` was `() => setStep('payment')` — did NOT call `placeTheOrder()`. Customer landed on a confusing "Placing your order…" intermediate card with another button; no loading indicator. | `e4fd899` | **Fixed.** `SmartPrintStudio.tsx:600` now reads `onProceed={() => { void placeTheOrder(); }}`. `StepPreview.tsx:451-456,480-486` shows the `placing` state on the proceed button. |
| 2 | `/api/shops/nearby` returned HTTP 500 | **High** (blocked location-based shop discovery) | Route imported `db` from `@/lib/db` (Prisma client) and used Prisma syntax (`select`, `where: { OR: [...] }`). In dev the container runs an in-memory adapter, NOT Prisma — the Prisma client queried a different/empty DB. | `9240810` | **Fixed.** Route now imports `getContainer` and uses `getContainer().db.findMany('shop', …)`. Browser E2E confirmed 3 shops load. |
| 3 | Scanner missing order-QR support | **Medium** (order tracking QR was unscannable) | Scanner only parsed `/s/[slug]` shop QR patterns; scanning an order QR (`/o/[token]`) did nothing — the scanner kept scanning silently. | `cd6f4b3` | **Fixed.** `src/app/scan/page.tsx:43` adds `extractOrderToken(payload)`; `:79` adds `goToOrder(token)`; `:111-112` checks both patterns in the scan loop; `:137` covers manual entry. Also added `NotReadableError` (camera-in-use) handling. |
| 4 | Idempotent retry on `placeOrder` | **Medium** (a refresh + re-tap "Proceed" regenerated orderNumber/pickupCode) | `placeOrder()` did not detect already-placed orders; it always generated a new `orderNumber`/`pickupCode`. | `cd6f4b3` | **Fixed.** `order-flow.ts:179-191` — if the order is already `awaiting_payment`/`queued`/`payment_submitted`, the function returns the existing `orderNumber`/`pickupCode`/`totalAmountPaise` from the DB instead of regenerating them. |
| 5 | 409 `PRICES_CHANGED` response didn't carry new total to client | Medium | `newTotalPaise` was in `error.details` but the client read `body.data?.totalPaise` (undefined). | prior Feature 4 session | **Fixed.** `src/app/api/v1/s/[slug]/orders/route.ts:82-96` now puts `data: { totalPaise, quote }` in the 409 body. |
| 6 | 5 routes still use `@/lib/db` (Prisma direct) | Low | Same root cause as Bug 2; affects gateway checkout + cron + sync + setup + db-health. | documented | **Not fixed** (lower priority — primary direct-UPI flow does not use these routes). |
| 7 | Customer email notifications not wired | Medium | `ResendEmailAdapter` exists but only `forgot-password` calls `container.email.send`. | documented | **Not fixed.** Adapter ready; needs to be called in `placeOrder` / `confirmPayment` / `refreshOrderPrintState`. |
| 8 | Push notifications (FCM/Web Push) | Medium | No push infrastructure exists. | documented | **Not fixed.** Requires Firebase project + service worker + device-token endpoint. |

---

## 9. Checkout Fix Verification (Phase A Re-Confirmed)

Source paths verified at commit `1169132`:

**`src/components/studio/SmartPrintStudio.tsx`**
- Line 109: `const [placing, setPlacing] = useState(false);`
- Lines 356–403: `placeTheOrder = useCallback(async () => { if (placing) return false; … setPlacing(true); … const result = await placeOrder(shop.slug, { … }); … setPlaced(result.data); setStep('payment'); savePendingOrder(…); saveRecentOrder(…); clearDraft(shop.slug); return true; … finally { setPlacing(false); } }, […, placing])` — guards double-place via the `placing` ref.
- Line 600: `<StepPreview … placing={placing} onProceed={() => { void placeTheOrder(); }} />` — this is the **exact line** the prior audit called out as the fix point. `onProceed` is wired to `placeTheOrder()`, NOT to `setStep('payment')`.
- Line 624: fallback button `onClick={() => void placeTheOrder()}` also present.

**`src/components/studio/steps/StepPreview.tsx`**
- Lines 451–456 (desktop) and 480–486 (mobile): the proceed button is `disabled={!canProceed || placing}` with `loading={placing}` and label `{placing ? 'Placing order…' : proceedLabel}`.

**`src/lib/orders/order-flow.ts:158-298` (`placeOrder`)**
- Lines 169–171: rejects when `shop.acceptingOrders === false` or `shop.isOpen === false`.
- Lines 173–191: **idempotent retry block** — if `order.status` is `awaiting_payment`/`queued`/`payment_submitted`, returns the existing `orderNumber`/`pickupCode`/`totalAmountPaise`/`token` without regenerating. This is the `cd6f4b3` fix.
- Lines 193–216: validates at least one printable file; reads `PrintSpec` rows for each; throws `ValidationError` if any spec is missing.
- Lines 218–228: re-quotes server-side; throws `PRICES_CHANGED` (with `newTotalPaise` + `newQuote`) when `clientTotalPaise` disagrees.
- Line 235: `nextStatus = /^COUNTER/i.test(paymentMode) ? 'queued' : 'awaiting_payment'` — UPI shops wait for payment; counter-only shops queue immediately.
- Line 236: `assertOrderTransition(order.status, nextStatus)` — state-machine guard.
- Lines 238–239: random `orderNumber` (4000–9999) + random `pickupCode` (1000–9999). See §10 risk #5.
- Lines 243–264: persists `status`, `customerName`, `customerPhone`, `customerId` (only if set), `notes`, `subtotalPaise`, `addonsPaise`, `totalAmountPaise`, `priceSnapshot`, `orderNumber`, `pickupCode`, `urgent`, `placedAt`, `expiresAt`, `paymentModeAtOrder`.
- Lines 266–271: appends `order_placed` (or `order_placed_counter`) event.
- Lines 277–281: fires `new_order` shopkeeper notification immediately.
- Lines 284–288: counter-only path builds tasks immediately; UPI path defers to `confirmPayment`.
- Lines 290–297: returns `{ orderId, token, pickupCode, orderNumber, totalPaise, pricesChanged: false }`.

**`src/lib/orders/order-flow.ts:301-458` (`submitPayment`)** — customer UTR/counter submission:
- Lines 322–328: `assertOrderTransition(order.status, 'payment_submitted')` (throws if order is past the payment window).
- Lines 335–339: rejects expired orders.
- Lines 341–345: validates UTR is 12-digit (`isValidUtr`).
- Lines 351–355: amount-mismatch guard (`AMOUNT_MISMATCH`).
- Lines 364–374: idempotency guard — returns the existing `SUBMITTED`/`PENDING` payment rather than creating a duplicate.
- Lines 382–399: duplicate-UTR-per-shop guard (excludes same-order idempotent retries and REJECTED payments).
- Lines 406–425: screenshot magic-byte (PNG/JPEG) + 2 MB size guard.
- Lines 432–442: creates the `Payment` row (`SUBMITTED` for UPI, `PENDING` for counter).
- Line 444: order transitions to `payment_submitted`.
- Lines 451–455: fires `payment_submitted` notification.

**`src/lib/orders/order-flow.ts:569-616` (`confirmPayment`)** — shopkeeper manual verify:
- Lines 581–583: idempotent re-confirm (CONFIRMED payment is a no-op).
- Line 585: `assertPaymentTransition(payment.status, 'CONFIRMED')`.
- Line 597: `assertOrderTransition(order.status, 'paid')`.
- Line 598: order flips to `paid`.
- Lines 610–614: `paid → queued` + builds tasks via `buildTasksForOrder`.

**Phase A conclusion**: the checkout fix is wired correctly. `StepPreview.onProceed` calls `placeTheOrder()` (not `setStep('payment')`), the `placing` guard prevents double-place on the client, and the server's idempotent-retry block (lines 173–191) returns the existing order reference on retry. Verified by code inspection at `1169132`. End-to-end browser proof (14 screenshots + checkout-result.png) is documented in `PRINTELYX-POST-STABILIZATION-VERIFICATION.md §5`.

---

## 10. Test Baseline

Re-verified at `1169132`:

| Check | Command | Result |
|---|---|---|
| `bunx tsc --noEmit` | `bunx tsc --noEmit` | **0 errors** |
| `bun run lint` | `bun run lint` | **0 errors**, 7 pre-existing warnings (all "Unused eslint-disable directive") |
| `bun run test` (full suite) | `vitest run` | **1043 passed, 23 skipped, 2 failed** |
| Payment state machine tests | `src/lib/payments/payment-state-machine.test.ts` | Pass |
| Checkout hardening tests | `src/lib/payments/checkout-hardening.test.ts` | Pass |
| Payment validation tests | `src/lib/security/payment-validation.test.ts` | Pass |
| Existing payment tests | `src/lib/payments/payments.test.ts` | Pass |
| Order flow integration | `src/lib/orders/order-flow.integration.test.ts` | Pass |

**The "57 tests" baseline referenced in the prior stabilization report** is the subset: 20 (payment state machine) + 17 (checkout hardening) + 13 (payment validation) + 7 (existing payments) = 57. All 57 pass.

**The 2 full-suite failures** are `payment-webhook-concurrency-phase3.test.ts` and `checkout-real-postgres.test.ts` — both require a live PostgreSQL instance at `127.0.0.1:5433` which is not running in this sandbox. They are not regressions; they are gated behind `vitest.postgres.config.ts` (`bun run test:postgres`).

**Test file inventory** (`find src/lib -name "*.test.ts"`): 72 test files across `src/lib/{api,auth,companion,contracts,crypto,customer,db,location,orders,payments,pipeline,pricing,printing,printlatch,repositories,security,services,storage}`. Additional Playwright specs live under `tests/` (smoke, accessibility, payment-utr, consumer-journey, security).

---

## 11. Runtime Baseline

| Component | Configuration | Source |
|---|---|---|
| Dev server | `next dev -p 3000 2>&1 \| tee dev.log` | `package.json:6` |
| Reverse proxy | Caddy on `:81`, `reverse_proxy localhost:3000` (with `XTransformPort` query escape hatch) | `Caddyfile:1-23` |
| Vercel deployment | `framework: nextjs`, `buildCommand: bash scripts/vercel-build.sh`, `installCommand: bun install --frozen-lockfile`, `regions: ["bom1"]` (Mumbai) | `vercel.json:2-8` |
| Vercel env | `DATABASE_PROVIDER=prisma`, `REALTIME_PROVIDER=memory`, `STORAGE_PROVIDER=supabase`, `CACHE_PROVIDER=memory` | `vercel.json:9-16` |
| Vercel crons | `/api/v1/cron/reconcile-payments` (02:00 daily), `/api/v1/cron/cleanup` (03:00), `/api/v1/cron/cleanup-uploads` (04:00) | `vercel.json:17-30` |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` on `(.*)` | `vercel.json:31-49` |
| Production start | `NODE_ENV=production bun .next/standalone/server.js` | `package.json:8` |
| Build | `prisma generate && next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/` | `package.json:7` |
| Database migrations (prod) | `prisma migrate deploy` via `scripts/pg-migrate-prod.sh` | `package.json:22`, `scripts/pg-migrate-prod.sh` |
| Container | `Dockerfile` + `docker-compose.yml` (alternative to Vercel) | repo root |

---

## 12. Incomplete Features

| Feature | Status | Required action |
|---|---|---|
| Customer email notifications | **Not wired.** `ResendEmailAdapter` is production-ready (`packages/adapters/src/email/resend.adapter.ts`) but only `forgot-password` calls `container.email.send`. | Call `container.email.send()` in `placeOrder` (order placed), `confirmPayment` (payment confirmed), `refreshOrderPrintState` (ready for pickup). Add templates. Set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM`. |
| Push notifications (FCM/Web Push) | **Not implemented.** No Firebase project, no service worker for Web Push, no device-token registration endpoint. | Build the full push pipeline: Firebase project + service worker + token registration + token refresh/removal + notification tap → deep link. **Per prior instruction: do not invent a push infrastructure without evaluating the existing architecture — the existing architecture has no push, so it is not invented here.** |
| ToroPay integration | **Not implemented.** No `ToroPayPaymentAdapter` exists; `PaymentAdapterRegistry` registers only `phonepe`, `paytm`, `upi-deeplink`, `razorpay` (`registry.ts:15-18`). No `toropay` value in `PaymentProvider` (no schema change has been made). | Implement a new `ToroPayPaymentAdapter` conforming to `PaymentAdapter` interface, register it in `PaymentAdapterRegistry`, extend the `PaymentProvider` union, add webhook route + signature verification. Requires a ToroPay API contract. |
| 5 routes still use `@/lib/db` (Prisma direct) | **Documented, not fixed.** Affects `orders/[id]/checkout`, `cron/cleanup`, `sync/push`, `setup-database`, `db-health`. The primary direct-UPI flow does NOT use these. | Migrate each to `getContainer().db` (container adapter). |
| Notification dedup | No DB-level `@@unique([shopId, orderId, kind])` on `Notification`. | Add partial unique index to prevent duplicate notifications on re-fired events. |
| `orderNumber` / `pickupCode` collision risk | Generated by `Math.floor(Math.random() …)` (`order-flow.ts:238-239`); no DB-level uniqueness backstop beyond the `customerToken` unique. | Use retry-on-collision loop or sequential per-shop counter. |
| Geocoding for manual location search | No address-to-coordinate endpoint; customer must use device GPS or text search. | Integrate a geocoding API. |
| Address-to-shop-card distance | `distanceKm` is null when coords missing (no fabrication). | Documented as a limitation. |

---

## 13. Risks of Changing Each Subsystem

| Subsystem | Risk if changed | Mitigation when touching |
|---|---|---|
| `Order.status` / state machine (`src/lib/orders/state-machine.ts`) | Any change to `TRANSITIONS` can break the idempotent no-op (`from === to`) and silently allow illegal transitions; the `placeOrder` idempotent retry depends on `awaiting_payment → awaiting_payment` being a no-op. The shopkeeper UI, the tracking page, the webhook processors, and the print-job planner all read these strings. | Run the full payment-state-machine + checkout-hardening + order-flow-integration test suites; add a transition test for any new edge before merging. |
| `Payment.status` / payment state machine | A new state or transition can create a "FAILED → SUCCESS" path that bypasses shopkeeper verification — the very invariant the post-stabilization report protects. The `confirmPayment`/`rejectPayment` idempotency checks assume `CONFIRMED` and `REJECTED` are terminal. | Keep `REJECTED` and `REFUNDED_NOTE` terminal; never add `FAILED`. Re-run fail-closed-verification tests. |
| `PaymentAdapter` interface (`packages/core/src/interfaces/payment.adapter.ts`) | The Phase 5.2.1 contract makes `merchantOrderId` mandatory and forbids adapter-generated references — weakening this reopens FIND-PAY-001-ORDER (provider confirmation arrives with no matching DB row). | Any new adapter MUST accept and reuse the supplied `merchantOrderId` verbatim. Add an `adapter-contract.test.ts` case for the new adapter. |
| `PaymentAdapterRegistry` (`src/lib/payments/registry.ts`) | Adding a provider is safe (call `register()`); removing one breaks shops configured with that provider. | Keep all 4 registered; only add. Verify `PaymentAttempt.provider` values match. |
| `placeOrder` / `submitPayment` / `confirmPayment` (`src/lib/orders/order-flow.ts`) | These are the money boundary. The idempotent retry block (lines 173–191), the amount-mismatch guard, the duplicate-UTR guard, the expiry guard, and the shopkeeper-notification side-effects are all load-bearing. | Re-run `checkout-hardening.test.ts`, `order-flow.integration.test.ts`, `checkout-idempotency.test.ts`, `app-checkout-concurrency.test.ts` after any change. |
| `SmartPrintStudio` `placeTheOrder` callback (`SmartPrintStudio.tsx:356-403`) | Reverting `onProceed={() => { void placeTheOrder(); }}` (line 600) to `setStep('payment')` reintroduces Bug #1 (checkout stuck). Removing the `placing` guard allows double-place. | Keep the `placing` ref guard; keep `onProceed` wired to `placeTheOrder()`. The server-side idempotent retry is the second layer of defense and MUST stay. |
| `StepPreview.tsx` proceed button | The `disabled={!canProceed || placing}` and `loading={placing}` props are the visible contract that the fix is in place. | Preserve both props when refactoring the preview UI. |
| `/api/shops/nearby` route | Re-introducing `import { db } from '@/lib/db'` breaks dev (in-memory container) and the homepage + `/find-a-shop`. | Always use `getContainer().db`. Add a smoke test that the route returns 200 in `DATABASE_PROVIDER=memory`. |
| `src/app/scan/page.tsx` scanner | Removing `extractOrderToken` / `goToOrder` reintroduces Bug #3 (order QR unscannable). | Keep both parsers in the scan loop AND the manual entry path. |
| Prisma schema | Zero-enum convention — adding a Prisma `enum` would diverge from the established pattern and require a migration that the state-machine code doesn't expect. Partial uniques are raw SQL; do not convert to `@@unique`. | Keep statuses as plain strings; add migrations under `prisma/migrations/`; run `prisma validate`. |
| `Order.customerToken` / `@@unique([shopId, customerToken])` | Weakening this constraint reintroduces the H9 token-collision IDOR. | Never remove the unique; the token generator relies on it as the collision backstop. |
| Webhook signature verification (Razorpay HMAC_SHA256, PhonePe SHA256, Paytm AES-128-CBC) | Any change to the verification path can convert a fail-closed system into a fail-open one. | Re-run `phonepe-v2-webhook.test.ts`, `paytm-checksum.test.ts`, `razorpay-webhook.ts` tests; keep `adapter.verifyPayment()` server re-check after every webhook. |
| Vercel crons | Removing `reconcile-payments` leaves orphan payments (paid at PSP but not finalized in the order). | Keep the 02:00 IST reconciliation cron; the reconciliation service is idempotent and bounded. |
| Customer journey localStorage keys (`printshop:pending-order`, `printshop:recent-orders`, `printshop:draft:<slug>`) | Renaming breaks refresh-restore (24 h TTL pending order, recent-orders list, draft). | Keep the key prefixes; version them via a suffix if schema changes. |

---

## 14. Limitations of This Audit

1. **Read-only.** No code was modified. This audit only writes one markdown file.
2. **Browser testing was NOT re-run.** The prior stabilization report's 14 Playwright screenshots + checkout-result.png are accepted as the E2E baseline; this audit re-verified the fix by inspecting the source at `1169132`.
3. **Device testing was NOT performed.** iOS Safari, Android Chrome, and Capacitor camera/geolocation behavior remain unverified.
4. **The 2 failing full-suite tests** (`payment-webhook-concurrency-phase3`, `checkout-real-postgres`) require a live PostgreSQL instance at `127.0.0.1:5433`. They are not regressions — they are Postgres-gated and run via `bun run test:postgres`.
5. **No ToroPay contract exists in the repository.** "ToroPay integration" is listed as an incomplete feature based on the absence of any `toropay` adapter, registry entry, or `PaymentProvider` value — not based on a documented roadmap.

---

## 15. Phase A Baseline Summary

| Dimension | Baseline |
|---|---|
| Framework | Next.js 16.1 App Router, React 19, Prisma 6 |
| Database | In-memory (dev) / PostgreSQL via Prisma (prod) |
| Payment adapters | 4 (PhonePe, Paytm, UPI deep-link, Razorpay); zero-commission; integer paise |
| State machines | Order (13 states) + Payment (5 states) + Task (11 states); server-side enforced |
| Consumer routes | 21 pages (12 core + 9 info/legal/auth) — all load, 3 prior bugs fixed |
| APIs | ~25 consumer/shopkeeper endpoints + 3 webhook routes + 3 crons |
| Tests | 1043 pass / 23 skip / 2 fail (Postgres-gated); **57-test payment subset all pass** |
| Type-check | `bunx tsc --noEmit` → **0 errors** |
| Lint | `bun run lint` → **0 errors**, 7 warnings |
| Runtime | dev `:3000` + Caddy `:81` + Vercel `bom1` standalone |
| Checkout fix | **Verified** — `StepPreview.onProceed → placeTheOrder()` (line 600) + idempotent retry (`order-flow.ts:173-191`) |
| Known bugs | All P0/P1 fixed; 2 medium + 3 low documented as future work |
| Incomplete features | Customer email, push notifications, ToroPay integration |

This is the Phase A baseline. The repository is in a verified-stable state for the next phase of consumer-platform work.

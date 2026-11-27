# PRINTELYX — Post-81a59a1 Independent Audit

**Audit date:** 2026-11-27
**Commit audited:** `81a59a1`
**Method:** Two independent code-level audit agents (very thorough) + verification of every finding against actual source. No assumptions from prior reports.

---

## Executive Summary

The independent audit found **3 build-breaking or flow-breaking defects** (2 now fixed), **5 security defects** in the reconciliation engine (2 now fixed), **3 shopkeeper UI defects** (documented, not fixed), and confirmed that **Gmail email ingestion is 100% missing** — the advertised feature is OAuth scaffolding + dead matching code with no trigger, no input, and no output.

### Verdict: **Not ready for staging**

The production build was broken at `81a59a1` (Prisma validate fails → Vercel build aborts). Fixed in this audit commit. The ToroPay webhook was dead-on-arrival (always 400). Fixed. Gmail reconciliation is vaporware plumbing. The shopkeeper's manual confirm path is UI-broken for `payment_submitted` orders.

---

## Phase 1 — Repository State Confirmed

- Branch: `main`, HEAD `81a59a1`, clean working tree.
- Diff `173d058..81a59a1`: 21 files, +1,020 lines.
- Production migrations are safe to run repeatedly (all `IF NOT EXISTS` + DO blocks). The ensure scripts (`ensure-gmail-reconciliation-tables.sql`) are idempotent.

---

## Phase 2 — Checkout and UTR Security Audit

### Q1: What happens when the customer presses the payment button?
`SmartPrintStudio.tsx:406-422` → `submitUtr()` → `studio-api.ts:309-321` POST `/api/v1/o/{token}/payment` → `order-flow.ts:301-458`. Creates a `Payment` row (`status: 'SUBMITTED'`), transitions order to `payment_submitted`. **Nothing marks it paid.**

### Q2: Is an order created before payment? What status?
Yes. Order born `draft` at upload init. `placeOrder()` transitions to **`awaiting_payment`** (or `queued` for counter shops). Payment happens only after the order exists, within a 30-minute window (`expiresAt`).

### Q3: What endpoint receives the UTR?
`POST /api/v1/o/[token]/payment` — the 128-bit path token is the only credential. Rate-limited 20/min. Zod-validated: `utr` must match `/^\d{12}$/`, `declaredAmountPaise` required.

### Q4: Does submitting a UTR automatically mark the order paid?
**NO.** The order transitions to `payment_submitted` — a distinct pre-paid state. Only `confirmPayment()` (shopkeeper action) or a verified webhook can transition to `paid`.

### Q5: What independently verifies money reached the shop?
**Nothing automated for direct-UPI.** The only verifier is the shopkeeper's manual confirmation (`POST /api/v1/shops/me/orders/[id]/confirm-payment`). The `PaymentVerifier` interface documents `MANUAL` as the default; no `AUTO` implementation exists. The gateway flow (ToroPay `payment.confirmed` webhook) provides signed verification.

### Q6: Can a fabricated UTR confirm an order?
A fabricated 12-digit UTR (e.g. `"123456789012"`) passes format validation and is stored. **But it cannot mark the order paid by itself** — no bank API is consulted; only the shopkeeper's confirm action can. Risk: the shopkeeper sees a plausible-looking UTR + amount and may confirm without checking their bank. Mitigations: duplicate-UTR scan, the `declaredAmountPaise` check (customer-attested), and the shopkeeper's own bank check.

### Q7: Can one UTR be reused across multiple orders?
- **App layer:** blocks reuse within the same shop (non-REJECTED payments). Cross-shop reuse allowed (by design). Reuse after rejection allowed (by design).
- **DB layer:** `Payment_utr_unique` is a **GLOBAL, status-agnostic** partial unique index (migration `20261127000000:48-50`). It blocks even the app-allowed flows (reuse after rejection, cross-shop) at the DB level → **unhandled P2002 → HTTP 500** on real Postgres. The in-memory test adapter doesn't model this index, so tests pass but production throws. **Defect D8 (unfixed — needs either scoped index or app-level P2002 handling).**

### Q8: Concurrent same-UTR submission?
The duplicate check is read-then-write (TOCTOU). Both requests pass the check, both INSERT. The DB unique index backstops (one wins). The loser's P2002 is **not caught** → raw 500 instead of a friendly message. **Defect D7 (unfixed — needs `isUniqueConstraintError` catch).**

### Q9: Payment succeeds but finalization fails?
For direct-UPI: `confirmPayment()` is a non-atomic 4-step chain (Payment→CONFIRMED, order→paid, order→queued, buildTasks). If it fails mid-way, the order sits in `queued` with zero tasks and the idempotent early-return prevents rebuild. **Defect D9 (unfixed — needs transaction or repair job).** The gateway flow does this correctly via `applyPaymentTransition` in a real Prisma `$transaction`.

### Q10: Refresh / closure / retry recovery?
Well covered: `savePendingOrder` (localStorage, 24h TTL), `readPendingOrder` restore on mount, UPI return detection (`markUpiLaunched`/`consumeUpiReturnFlag` + `visibilitychange`), server-side durability (order + payment + events in Postgres, `/o/[token]` works forever once submitted).

### Q11: Customer sees order number + tracking URL?
**Yes.** StepConfirmation shows the order number (copyable), amount, pickup code, shop, and a "Track your order" link to `/o/{token}` in every state. Minor gap: no automatic polling loop on the confirmation screen (manual refresh button + the tracking page has live polling).

### Q12: Shopkeeper sees the same order + payment status?
**SEVERELY BROKEN — the shopkeeper cannot confirm a submitted UTR from the UI:**
- Order detail page (`shop/orders/[id]/page.tsx:517`): the Confirm/Reject card renders **only when `status === 'awaiting_payment'`**. After the customer submits a UTR (`payment_submitted`), the card disappears.
- Payments page (`shop/payments/page.tsx:61-66`): classifies `payment_submitted` as `'verified'` → shows in the "Confirmed" tab with no confirm button.
- Orders board: `payment_submitted` is not in any bucket → the order vanishes from the kanban/mobile tabs.
- Walk-in flow (`shop/walk-in/page.tsx:301-329`): calls `confirm-payment` with no Payment row → always fails.
**Defects D4/D5/D6 (unfixed — requires shopkeeper UI fixes).**

---

## Phase 3 — Gmail OAuth and Ingestion Audit

### OAuth (implemented, competent)

| Check | Status |
|---|---|
| Authorization URL | ✅ `accounts.google.com/o/oauth2/v2/auth` |
| CSRF state validation | ✅ Cookie nonce (httpOnly, 10-min TTL) + state param |
| Token exchange server-side | ✅ Only in callback route |
| Refresh token encrypted | ✅ AES-256-GCM via `PAYMENT_ENCRYPTION_KEY` |
| Token revocation on disconnect | ✅ Best-effort revoke + row delete |
| Tenant isolation | ✅ Owner-auth routes; `repos.shops.getByOwner` |
| Scope | ✅ `gmail.readonly` only |

### Ingestion (100% MISSING)

**The Gmail reconciliation feature advertised in commit `81a59a1` is OAuth scaffolding + dead matching code:**

| Required component | Exists? |
|---|---|
| Gmail API client (`gmail.googleapis.com`, `users.messages`, `users.history`) | ❌ Zero code matches |
| Cron that polls Gmail | ❌ `src/app/api/v1/cron/` has no Gmail routes |
| Email parser | ❌ No `parseEmail`/`parsePaymentEmail`/`extractAmount` |
| Sender allowlist | ❌ No code, no config |
| PaymentEvidence INSERT path | ❌ No code creates evidence rows |
| Caller of `reconcileEvidence` | ❌ Zero call sites — dead code |
| Shopkeeper Gmail connection UI | ❌ No UI consumes the status endpoint |
| `refreshAccessToken` callers | ❌ Zero — only OAuth, never used to read mail |

**Honest status: OAuth is implemented and secure. Gmail monitoring does not exist. Connecting Gmail gives the shopkeeper zero functionality.**

---

## Phase 4 — Payment Evidence and Reconciliation Audit

### Confirmed security defects (2 FIXED in this audit, 1 unfixed)

| # | Defect | Status |
|---|---|---|
| 1 | No receiving-UPI validation — evidence for a different merchant's account could auto-confirm | **FIXED** — now compares `evidence.receivingUpiId` against `shop.upiId` |
| 2 | No currency check — non-INR payment with matching paise could auto-confirm | **FIXED** — now rejects non-INR |
| 3 | No DB-level concurrency guard — two concurrent `reconcileEvidence` calls both pass the check | **UNFIXED** — moot while the engine is dead code; must add conditional `WHERE processingStatus='pending'` before wiring |
| 4 | No incoming-credit/direction check | **UNFIXED** — no credit/debit field exists |
| 5 | Matching rules gap vs. docstring (no credit direction, no explicit refunded check) | Documented |

### Evidence classification (required by the brief)

| Classification | Implementation status |
|---|---|
| Verified by authenticated provider API/webhook | ToroPay `payment.confirmed` webhook (HMAC-verified) — implemented |
| Strong secondary evidence requiring configured validation | Gmail evidence with UTR + exact amount + UPI match — **engine exists but has no input** |
| Unverified candidate requiring manual review | Routed to `processingStatus='pending'` — **no UI shows the queue** |
| Rejected or duplicate evidence | Routed to `processingStatus='rejected'` — **no UI shows rejected evidence** |

---

## Phase 5 — ToroPay Verification

### Confirmed defects (2 FIXED in this audit)

| # | Defect | Fix |
|---|---|---|
| 1 | Webhook always returned 400 — `extractReference` had no `'toropay'` branch, so the pipeline failed at step 2 (before signature verification) | **FIXED** — added ToroPay branch parsing `data.order.merchant_order_id` |
| 2 | Classification lumped `payment.paid`/`order.paid` (legacy names) with `payment.confirmed` → all auto-finalized, risking auto-finalizing on customer claims | **FIXED** — only `payment.confirmed` auto-finalizes; legacy names are informational |

### Verified correct

| Check | Status |
|---|---|
| HMAC-SHA256 on raw body | ✅ `verifyToroPaySignature` + `timingSafeEqual` |
| Missing secret → fail-closed | ✅ 503 |
| Invalid signature → 400 | ✅ |
| Amount validated against session | ✅ In `processWebhook` + inside lifecycle transaction |
| Currency | ⚠️ Hardcoded `INR` in pipeline; payload currency not checked |
| Event dedup | ✅ `PaymentEvent @@unique([provider, eventId])` |
| Tenant isolation | ✅ Session-based lookup; `attempt.shopId` re-validated |

---

## Phase 6 — Payment State Machine

The existing dual state machines are documented and correct:

**Order status** (`state-machine.ts`): `draft → awaiting_payment → payment_submitted → paid → queued → printing → partially_printed → ready → collected` (+ `paid_on_pickup`, `cancelled`, `failed`, `expired`). All transitions enforced server-side via `assertOrderTransition`.

**Payment status** (`payment-state-machine.ts`): `PENDING/SUBMITTED → CONFIRMED|REJECTED → REFUNDED_NOTE`. Idempotent same-status. `REJECTED` and `REFUNDED_NOTE` are terminal.

**Gateway lifecycle** (`lifecycle.service.ts`): `created → pending → paid/failed/expired` via atomic `applyPaymentTransition` in a real Prisma `$transaction` with conditional `WHERE status` guards + UNIQUE-constraint arbitration.

No duplicate state systems were introduced. Frontend buttons never set paid — only server-side transitions do.

---

## Phase 7 — Shopkeeper Operational Visibility

| Required | Status |
|---|---|
| Gmail connection status | ❌ No UI (API endpoint exists, no consumer) |
| Last successful sync | ❌ Stored but never displayed |
| Disconnect Gmail | ❌ API exists, no UI |
| Payment evidence queue | ❌ No UI |
| Automatically matched transactions | ❌ No UI (dead engine) |
| Unmatched/ambiguous transactions | ❌ No UI |
| Manual review workflow | ❌ No UI |
| Confirm a submitted UTR | ❌ **UI-broken** (confirm card hidden for `payment_submitted`) |
| Audit history | Partial (OrderEvent + PaymentEvent persisted, no dedicated UI) |
| No token/secret exposure to browser | ✅ Verified — no `NEXT_PUBLIC_`, no token in responses |

---

## Phase 8 — Test Results

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun run lint` | **0 errors**, 7 pre-existing warnings |
| Payment state machine tests (20) | **20/20 pass** |
| Checkout hardening tests (17) | **17/17 pass** |
| Payment validation tests (13) | **13/13 pass** |
| `prisma validate` | **PASSES** (was failing before this fix) |
| Postgres-only tests (2 files) | Not run (no `TEST_DATABASE_URL`) |
| ToroPay webhook tests | **ZERO exist** — the reason defect P0-2 was never caught |
| Gmail ingestion tests | **ZERO exist** — nothing to test |
| Browser E2E (previous session) | Checkout flow verified (14 screenshots) |

### Untested scenarios (from the brief)

All 18 listed scenarios (incorrect amount, wrong UPI ID, duplicate UTR, outgoing email, expired cursor, invalid signature, etc.) are **untested** — most require infrastructure that does not exist (Gmail ingestion) or test files that were never written (ToroPay webhook).

---

## Confirmed Defect Register (Final)

| # | Severity | Defect | Status |
|---|---|---|---|
| D1 | P0 | Prisma schema invalid (dual relation on PaymentEvidence.shopId) → production build aborts | **FIXED** |
| D2 | P0 | ToroPay webhook always 400 (no toropay branch in extractReference) | **FIXED** |
| D3 | P0 | Gmail ingestion 100% missing | **Documented — not implemented** |
| D4 | P1 | Shopkeeper cannot confirm submitted UTR from UI (confirm card hidden for payment_submitted) | **Unfixed** |
| D5 | P1 | Walk-in flow always fails (confirm-payment with no Payment row) | **Unfixed** |
| D6 | P1 | Payments page shows payment_submitted as "verified" | **Unfixed** |
| D7 | P1 | Concurrent same-UTR → unhandled P2002 → 500 | **Unfixed** |
| D8 | P1 | DB Payment_utr_unique contradicts app semantics (reject/cross-shop reuse throws 500 on Postgres) | **Unfixed** |
| D9 | P1 | confirmPayment non-atomic (crash → queued with zero tasks, no repair) | **Unfixed** |
| D10 | P2 | No receiving-UPI validation in reconciliation | **FIXED** |
| D11 | P2 | No currency check in reconciliation | **FIXED** |
| D12 | P2 | ToroPay classification lumped legacy events with confirmed | **FIXED** |
| D13 | P2 | No DB concurrency guard on evidence processing | Unfixed (moot — dead code) |
| D14 | P2 | No credit-direction check in reconciliation | Unfixed (moot — dead code) |
| D15 | P3 | No Gmail UI, no reconciliation queue UI | Unfixed |
| D16 | P3 | Adapters package imports app alias (`@/lib/...`) | Unfixed |

---

## Final Verdict

**NOT READY FOR STAGING.**

Blockers:
1. Gmail ingestion does not exist (the feature advertised in `81a59a1` is OAuth-only scaffolding).
2. The shopkeeper's primary workflow (confirm a customer's submitted UTR) is broken in the UI (D4).
3. The DB duplicate-UTR index contradicts the application's tested semantics (D8) — production-only 500s.
4. Zero ToroPay webhook tests (D2's root cause — the same class of defect can recur undetected).

The checkout-to-UTR-submission customer flow IS production-honest (order stays `payment_submitted`, never falsely paid). The OAuth layer IS secure. The state machines ARE correct. But the "automated payment reconciliation" feature is not real, and the shopkeeper confirm path is UI-broken.

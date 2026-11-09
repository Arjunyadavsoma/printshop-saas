# Financial Reporting — Audit

> Audit of financial reporting across the SaaS backend. Documents the 7 distinct financial values that MUST be kept separate, checks existing reports for incorrect combinations, verifies payment webhook idempotency, and notes that webhook success ≠ bank settlement.

**Audit date:** 2025-11-08 · **Commit:** `dc24f4b`
**Evidence labels:** VERIFIED (source-confirmed), IMPLEMENTED, NOT VERIFIED

---

## 1. The 7 distinct financial values

These values MUST NEVER be combined in a single report field. Each is a separate business concept with a different source of truth.

### 1.1 Shop-side values (per shop)

| # | Value | Source of truth | Definition |
|---|---|---|---|
| 1 | **Shop order value** | `Order.totalAmountPaise` (sum) | Gross value of all orders created for the shop (regardless of payment status) |
| 2 | **Shop payment volume** | `Order.totalAmountPaise WHERE paidAt IS NOT NULL AND paymentTxnId IS NOT NULL` | Value of orders actually paid (verified via webhook or manual verify) |
| 3 | **Shop refunds** | (Refund model — Phase 2, NOT IMPLEMENTED) | Value of refunds issued to customers |
| 4 | **Estimated shop revenue** | Shop payment volume − Shop refunds − PrintShop subscription fee | What the shopkeeper actually keeps |

### 1.2 Platform-side values (PrintShop's own books)

| # | Value | Source of truth | Definition |
|---|---|---|---|
| 5 | **PrintShop subscription revenue** | `Subscription` model with `provider='razorpay'|'stripe'` (NOT IMPLEMENTED) | Monthly/annual fees paid BY shops TO PrintShop |
| 6 | **PrintShop refunds** | (Refund model for subscription refunds — NOT IMPLEMENTED) | Subscription refunds issued to shops |
| 7 | **PrintShop net subscription revenue** | Value 5 − Value 6 | PrintShop's actual take |

**Critical distinction:** Values 1-4 are about the SHOP's customers paying the SHOP. Values 5-7 are about the SHOP paying PRINTSHOP. These are completely separate financial flows and MUST NOT be mixed in any report.

---

## 2. Existing reports — audited

### 2.1 `GET /api/v1/shops/me/reports/daily` — VERIFIED

**File:** `src/app/api/v1/shops/me/reports/daily/route.ts:1-74`
**Auth:** `withAuth(['owner'])` (line 73)

**Fields returned (lines 52-65):**
- `totalOrderValue` = sum of `totalAmountPaise` for today's orders (line 46)
- `verifiedCollections` = sum where `paidAt AND paymentTxnId` (line 47)
- `outstanding` = sum where `status === 'awaiting_payment'` (line 48)
- `cancelledValue` = sum where `status === 'cancelled'` (line 49)

**Findings:**
- ✅ Correctly distinguishes Value 1 (totalOrderValue) from Value 2 (verifiedCollections)
- ✅ Timezone-safe — uses `getZonedDayBounds(shop.timezone)` (lines 30-32, fixes DB-002)
- ✅ Never counts customer-submitted UTR as verified — only `paidAt + paymentTxnId` (line 47)
- ❌ **No refund field** (Value 3) — `Refund` model is Phase 2, NOT IMPLEMENTED
- ❌ **No "estimated shop revenue" field** (Value 4) — would be `verifiedCollections − refunds − subscriptionFee`
- ❌ **No PrintShop subscription fee deduction** (Value 5) — Subscription model vestigial

**Severity:** P2 — reports are correct for what they show, but incomplete. No incorrect combinations found.

### 2.2 `GET /api/v1/admin/analytics` — VERIFIED

**File:** `src/app/api/v1/admin/analytics/route.ts:1-104`
**Auth:** `withAuth(['admin'])` (line 104)

**Fields returned (lines 77-103):**
- `grossPaidValuePaise` = sum of `totalAmountPaise` for orders NOT in `cancelled`/`awaiting_payment` (line 46)
- `shopEarningsPaise` = same as `grossPaidValuePaise` (line 86 — comment: "0% commission")
- `platformRevenuePaise` = 0 (line 87 — comment: "NO commission model — documented")
- `failedOrDisputed` = `byStatus.cancelled` (line 92 — ARCH-006 fix)
- Per-shop breakdown: `shopWise[].revenuePaise` (line 64)

**Findings:**
- ✅ ARCH-006 bug FIXED — was previously double-counting cancelled orders (lines 89-92)
- ✅ Correctly sets `platformRevenuePaise = 0` (no commission model — explicit comment)
- ✅ Correctly states `shopEarningsPaise = grossPaidValuePaise` (0% commission)
- ❌ **No refund tracking** (Value 3, Value 6) — Refund model not implemented
- ❌ **No PrintShop subscription revenue** (Value 5) — `Subscription` model vestigial; admin sees only customer-order flow, not PrintShop's own revenue
- ❌ **Mixes concepts in `failedOrDisputed`** — `byStatus.cancelled` may include both unpaid-cancelled AND paid-then-refunded orders (once refunds exist). Recommendation: split into `cancelledUnpaid` and `refundedPaid` when Refund model lands.

**Severity:** P2 — current values are correct given no refunds/no subscription model exist. But the field shape will need to change when those land.

### 2.3 `GET /api/v1/shops/me/analytics` — VERIFIED

**File:** `src/app/api/v1/shops/me/analytics/route.ts:1-52`
**Auth:** `withAuth` (no role restriction — line 9)

**Fields returned (lines 44-51):**
- `revenue.totalPaise` = sum of `totalAmountPaise` for paid orders (line 14)
- `orderCount`, `byStatus`, `popular` settings, `peakHourUtc`, `hours` histogram

**Findings:**
- ✅ Correctly uses "paid orders" filter (line 13: `o.status !== 'cancelled' && o.status !== 'awaiting_payment'`)
- ❌ Lacks role restriction (`withAuth` with no `['owner']` — SEC-010 concern)
- ❌ No refund deduction (Value 3)
- ❌ No subscription fee deduction (Value 5)

**Severity:** P2.

---

## 3. Payment webhook idempotency — VERIFIED

**File:** `src/lib/payments/webhook.service.ts:1-335`

### 3.1 Idempotency mechanisms (4 layers)

| Layer | Mechanism | Evidence |
|---|---|---|
| 1. DB-level | `Order.paymentTxnId @unique` | `prisma/schema.prisma:83` |
| 2. Cache dedup | `pay:done:{provider}:{txnId}` (24h TTL) | `webhook.service.ts:161, 262` |
| 3. Race-safe state transition | `transitionStatus(order.id, shop.id, 'awaiting_payment', ...)` | `webhook.service.ts:224-243` |
| 4. UNIQUE-constraint catch | `isUniqueConstraintError(err)` → idempotent skip | `webhook.service.ts:247-256` |

### 3.2 Amount validation — VERIFIED MANDATORY

**Critical fix documented at lines 182-206:** previously the check was `if (v.amountPaise !== null && ...)` which SKIPPED validation when the PSP omitted the amount — allowing a ₹0 payment to mark a ₹500 order paid. Now: missing amount → 400 reject (lines 187-196); mismatch → 400 reject (lines 197-206).

```typescript
if (v.amountPaise === null) {
  return { statusCode: 400, summary: 'amount missing — cannot verify payment integrity', applied: false };
}
if (v.amountPaise !== order.totalAmountPaise) {
  return { statusCode: 400, summary: `amount mismatch (expected ${order.totalAmountPaise}, got ${v.amountPaise})`, applied: false };
}
```

### 3.3 Signature verification — VERIFIED fail-closed

| Provider | Verification | File |
|---|---|---|
| PhonePe v1 | X-VERIFY (SHA-256 + base64 + salt) | `packages/adapters/src/payment/phonepe.adapter.ts` |
| PhonePe v2 | SHA-256(username:password) auth header | `src/lib/payments/phonepe-v2-webhook.ts:55-69` |
| Paytm | CHECKSUMHASH (AES-128-CBC + SHA-256) | `packages/adapters/src/payment/paytm.adapter.ts` |

All verification is fail-closed: if env vars are unset, webhooks are rejected (`docs/SECURITY_ASSESSMENT.md:122`).

### 3.4 Idempotency verdict

**Status:** VERIFIED — 4-layer idempotency is structurally sound. Duplicate webhooks, concurrent webhooks, and replays are all handled. 234 existing tests cover the payment lifecycle (`docs/PRODUCTION_READINESS_AUDIT.md:271-279`).

---

## 4. Webhook success ≠ bank settlement — IMPORTANT CAVEAT

### 4.1 What webhook success means

When `processWebhook` returns `{applied: true, statusCode: 200}`, it means:
- The PSP sent a webhook
- The signature verified
- The amount matched the order
- The order was flipped to `paid` (race-safe)
- Print jobs were enqueued

**It does NOT mean:**
- The customer's bank has settled the funds to the shop's bank account
- The PSP has settled the funds to the shop's merchant account
- The transaction cannot be reversed (chargebacks, refunds, disputes)

### 4.2 Bank settlement timing (India, UPI)

- UPI: instant authorization, T+1 bank settlement (next business day)
- PhonePe/Paytm: instant authorization, T+1 to T+2 settlement to merchant
- Settlement files: PSP provides daily settlement reports (separate from webhooks)

### 4.3 Implication for reports

`Order.paidAt + paymentTxnId` = **payment authorized** (webhook-verified)
≠ **payment settled** (bank reconciliation)

The current reports (`daily`, `analytics`) treat webhook-verified payments as revenue. This is correct for operational reporting but **incorrect for accounting/reconciliation**.

### 4.4 Required separation (when reconciliation is built)

| Concept | Source | When |
|---|---|---|
| Authorized | Webhook → `Order.paidAt` | Real-time |
| Settled | PSP settlement file → new `Settlement` model | T+1/T+2 |
| Reconciled | Match authorized → settled | Daily batch |

The current `Order.paidAt` field MUST NOT be relabeled as "settled." A new `Settlement` model is needed for bank reconciliation (Phase 2+ — not yet designed).

---

## 5. The `PaymentAttempt`/`PaymentEvent` gap — VERIFIED NOT WIRED

**Files:** `prisma/schema.prisma:197-238` (models exist), `src/lib/payments/webhook.service.ts:27-35` (cache-only lookup), `src/lib/payments/phonepe-v2-webhook.ts:167, 215` (TODO comments)

**Current state:** the `merchantOrderId → orderId` mapping lives ONLY in cache (`lookupPaymentSession`, 10-min TTL — `webhook.service.ts:12`). Slow PSPs (>10 min) or Vercel cold starts (per-invocation memory) make delayed webhooks impossible to resolve.

**Code evidence (TODOs):**
- `phonepe-v2-webhook.ts:167` — `// TODO: when PaymentEvent model is wired, persist this event.`
- `phonepe-v2-webhook.ts:215` — `// Look up the payment session (cache — TODO: also check PaymentAttempt DB).`

**Severity:** P2 — KNOWN_LIMITATIONS P2-1.

**Fix:** Replace `lookupPaymentSession` (cache) with `PaymentAttempt.findOne({merchantOrderId})` (DB) as primary lookup, with cache as a fast-path overlay.

---

## 6. Findings summary

| ID | Finding | Severity | Status |
|---|---|---|---|
| FIN-001 | 7 financial values not all represented in reports | P2 | Values 3, 4, 5, 6, 7 missing (Refund + Subscription models not wired) |
| FIN-002 | `daily` report lacks refund field | P2 | Refund model not implemented |
| FIN-003 | `admin/analytics` lacks PrintShop subscription revenue | P2 | Subscription model vestigial |
| FIN-004 | `admin/analytics` `failedOrDisputed` may mix unpaid-cancelled + paid-refunded | P3 | Future risk when refunds land |
| FIN-005 | Webhook success ≠ bank settlement (not documented in reports) | P2 | Operational vs accounting gap |
| FIN-006 | `PaymentAttempt`/`PaymentEvent` models vestigial (cache-only webhook lookup) | P2 | KNOWN_LIMITATIONS P2-1 |
| FIN-007 | `shops/me/analytics` lacks role restriction | P3 | SEC-010 defense-in-depth gap |
| FIN-008 | Webhook idempotency is structurally sound (4 layers) | — | VERIFIED — no action |
| FIN-009 | Amount validation is mandatory (Phase 4 fix) | — | VERIFIED — no action |
| FIN-010 | Signature verification fail-closed | — | VERIFIED — no action |

---

## 7. Recommendations

1. **Do NOT combine values 1-4 with values 5-7** in any report field. They are different financial flows.
2. **When Refund model lands:** add `refundsPaise` to `daily` report; split `failedOrDisputed` into `cancelledUnpaid` and `refundedPaid` in `admin/analytics`.
3. **When Subscription model lands:** add `subscriptionRevenuePaise` (Value 5) to `admin/analytics`; add `subscriptionFeePaise` deduction to shop `daily` report (Value 4 computation).
4. **Wire `PaymentAttempt`/`PaymentEvent`** — replace cache-only lookup with DB-primary lookup. This is the highest-priority fix in this audit (closes FIN-006).
5. **Document webhook-success-vs-settlement gap** in the daily report's API response (add a `note` field: "Verified payments are PSP-authorized, not bank-settled. Reconcile with PSP settlement files for accounting.").
6. **Add `['owner']` to `shops/me/analytics`** `withAuth` call (FIN-007 / SEC-010).

---

## References
- `docs/FINANCIAL_BUSINESS_LOGIC.md` — canonical financial rules (all money is integer paise, server-authoritative)
- `docs/PRODUCTION_READINESS_AUDIT.md:267-279` — payment pipeline test evidence
- `docs/SECURITY_ASSESSMENT.md:106-141` — payment security (encryption, webhook verification, idempotency, amount validation)
- `prisma/schema.prisma:197-238` — `PaymentAttempt` + `PaymentEvent` models
- `src/lib/payments/webhook.service.ts:1-335` — webhook pipeline

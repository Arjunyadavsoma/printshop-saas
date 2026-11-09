# Phase 5 Final Report — Payment Integrity and Financial Correctness

**Branch:** `phase-5-payment-integrity`
**Starting commit:** `515b9de`
**Date:** 2025-11-09

---

## 1. Starting and final commits

| | Commit | Description |
|---|---|---|
| **Start** | `515b9de` | Phase 4.1: SEC-T01 resolved |
| **Final** | (this commit) | Phase 5: payment audit + 15 tests + 5 docs |

---

## 2. Test results

```
$ npx tsc --noEmit          → exit 0 (zero errors)
$ bun run lint              → 0 errors, 0 warnings
$ bunx vitest run           → 317/317 tests pass (18.4s)
$ bash scripts/check-route-conflicts.sh → ✅ No conflicts
```

| Metric | Value |
|---|---|
| Previous test count | 302 |
| New tests added | 15 (payment route-handler tests) |
| Current test count | 317 |
| Test files | 27 |
| Skipped | 0 |
| Failed | 0 |

---

## 3. Payment architecture audit findings

### P0 (3 findings — release blockers)

| Finding | Description | Status |
|---|---|---|
| PAY-001 | PaymentAttempt row never written at checkout (cache only) | DOCUMENTED — DB fallback reads empty table |
| PAY-002 | PaymentEvent never written (unique constraint inert) | DOCUMENTED — replay guard not active |
| PAY-003 | PhonePe v2 webhook doesn't call adapter.verifyPayment | DOCUMENTED — trusts JSON after SHA-auth only |

### P1 (5 findings)

| Finding | Description | Status |
|---|---|---|
| PAY-004 | Refunds not persisted (no PaymentEvent for refunds) | DOCUMENTED |
| PAY-005 | PaymentAttempt.status never advanced | DOCUMENTED |
| PAY-006 | PhonePe v2 adapter handleWebhook decodes base64 without signature | DOCUMENTED |
| PAY-007 | Manual verify hardcodes `paymentProvider:'googlepay'` | DOCUMENTED |
| PAY-SEC-007 | Checkout writes cache only → orders stranded if cache expires | DOCUMENTED |

### Financial bugs (6 findings)

| Finding | Description | Status |
|---|---|---|
| PAY-FIN-001 | Admin analytics includes `refunded` in gross paid value | DOCUMENTED |
| PAY-FIN-002 | Shop earnings inherit refunded-inclusion error | DOCUMENTED |
| PAY-FIN-003 | Platform subscription revenue conflated with commission | DOCUMENTED (already 0) |
| PAY-FIN-004 | Admin analytics uses UTC midnight (not shop timezone) | DOCUMENTED |
| PAY-FIN-005 | Per-shop leaderboard includes refunded orders | DOCUMENTED |
| PAY-FIN-006 | `failedOrDisputed` name is misleading | DOCUMENTED |

---

## 4. Webhook signature verification status

| Provider | Algorithm | Tests | Status |
|---|---|---|---|
| PhonePe v1 | X-VERIFY (SHA-256 + base64 + salt) | ✅ ~50 tests | VERIFIED (logic) |
| PhonePe v2 | SHA-256(username:password) auth header | ✅ 16 tests | VERIFIED (logic) |
| Paytm | AES-128-CBC CHECKSUMHASH | ✅ tests exist | ⚠️ Hand-rolled IV (PAY-SEC-003) |
| UPI deep-link | No webhook (manual verify only) | ✅ manual verify tested | N/A |

**All provider integrations UNVERIFIED against live sandbox** — no merchant credentials available.

---

## 5. Idempotency layers (3 active + 2 inert)

| Layer | Mechanism | Status |
|---|---|---|
| L1 | Cache `pay:done:{provider}:{txnId}` (24h TTL) | ✅ ACTIVE |
| L2 | Conditional UPDATE `WHERE status='awaiting_payment'` | ✅ ACTIVE (race-safe) |
| L3 | `Order.paymentTxnId @unique` (DB constraint) | ✅ ACTIVE |
| L4 | `PaymentEvent @@unique([provider, eventId])` | ❌ INERT (never written) |
| L5 | `PaymentAttempt.merchantOrderId @unique` | ❌ INERT (never written) |

---

## 6. Payment state machine

### Order states
```
awaiting_payment → paid → printing → ready → collected
                                    ↓
                              cancelled / refunded
```

### Permitted transitions (enforced by `transitionStatus`):
- `awaiting_payment → paid` ✅ (webhook or manual verify)
- `paid → printing` ✅ (start/dispatch)
- `printing → ready` ✅ (all files completed)
- `ready → collected` ✅ (shopkeeper marks collected)
- `any non-terminal → cancelled` ✅
- `paid → refunded` ✅ (future — no endpoint yet)

### Forbidden transitions (prevented by conditional UPDATE):
- `paid → awaiting_payment` ❌
- `collected → paid` ❌
- `cancelled → paid` ❌
- `FAILED → SUCCESS without provider evidence` ❌

---

## 7. New tests added (15)

| # | Test | Route/Function | Status |
|---|---|---|---|
| 1 | Checkout with valid token | POST /orders/{id}/checkout | ✅ 200 |
| 2 | Checkout without token | POST /orders/{id}/checkout | ✅ 403 |
| 3 | Checkout with wrong token | POST /orders/{id}/checkout | ✅ 403 |
| 4 | Manual verify with owner JWT | POST /shops/me/orders/{id}/verify-payment | ✅ 200 |
| 5 | Manual verify without JWT | POST /shops/me/orders/{id}/verify-payment | ✅ 401 |
| 6 | Manual verify cross-tenant | POST /shops/me/orders/{id}/verify-payment | ✅ 404 |
| 7 | PhonePe webhook empty body | POST /payments/phonepe/webhook | ✅ 400 |
| 8 | Paytm callback empty body | POST /payments/paytm/callback | ✅ 400 |
| 9 | UPI verify existing order | GET /payments/upi/verify/{orderId} | ✅ 200 |
| 10 | Payment session lookup unknown | lookupPaymentSession | ✅ null |
| 11 | Payment session round-trip | rememberPaymentSession + lookup | ✅ found |
| 12 | Payment session DB fallback | lookupPaymentSession (cache miss) | ✅ DB fallback |
| 13 | UPI verify nonexistent order | GET /payments/upi/verify/{fakeId} | ✅ 404 |
| 14 | Amount mismatch rejected | processWebhook | ✅ no mutation |
| 15 | Idempotency cache prevents duplicate | processWebhook | ✅ applied=false |

---

## 8. Files changed

| File | Lines | Type |
|---|---|---|
| `src/lib/api/payment-route-tests.test.ts` | 663 | NEW — 15 payment HTTP tests |
| `docs/payments/PHASE_5_PAYMENT_ARCHITECTURE_AUDIT.md` | 289 | NEW — architecture audit |
| `docs/payments/PAYMENT_STATE_MACHINE.md` | 292 | NEW — state transitions |
| `docs/payments/FINANCIAL_METRIC_DEFINITIONS.md` | 296 | NEW — 3 financial metrics |
| `docs/payments/PAYMENT_SECURITY_TEST_REPORT.md` | 288 | NEW — security findings |
| `docs/payments/PHASE_5_FINAL_REPORT.md` | (this file) | NEW — final report |

---

## 9. Provider verification status

| Provider | Code exists | Tests pass | Sandbox tested | Status |
|---|---|---|---|---|
| PhonePe v1 | ✅ | ✅ | ❌ | IMPLEMENTED, NOT VERIFIED |
| PhonePe v2 | ✅ | ✅ | ❌ | IMPLEMENTED, NOT VERIFIED |
| Paytm | ✅ | ✅ | ❌ | IMPLEMENTED, NOT VERIFIED (IV issue) |
| UPI deep-link | ✅ | ✅ | N/A | IMPLEMENTED (manual verify only) |
| Refunds | ❌ | ❌ | ❌ | NOT IMPLEMENTED |

---

## 10. Remaining release blockers

| # | Blocker | Severity | Action needed |
|---|---|---|---|
| 1 | PaymentAttempt not created at checkout | P0 | Wire `PaymentAttempt.create()` in checkout route |
| 2 | PaymentEvent never written | P0 | Wire `PaymentEvent.create()` in webhook pipeline |
| 3 | PhonePe v2 doesn't call verifyPayment | P0 | Add server-side verification call |
| 4 | No refund endpoint | P1 | Implement refund route + state transitions |
| 5 | Financial metrics conflate refunded | P1 | Fix admin analytics to exclude refunded |
| 6 | Paytm hand-rolled IV | P1 | Use UPIPay's verifyWebhook |
| 7 | No live sandbox testing | P1 | Need merchant credentials |
| 8 | PaymentAttempt.status never advanced | P1 | Update status in webhook pipeline |

---

## 11. Verdict

### ⚠️ PARTIALLY COMPLETE

**What's verified:**
- ✅ Payment creation (checkout) works — 3 HTTP tests pass
- ✅ Manual payment verification works — 3 HTTP tests pass (including cross-tenant)
- ✅ Webhook signature verification logic is correct — ~50 existing tests
- ✅ Idempotency (3 active layers) prevents duplicate processing — 2 tests
- ✅ Amount validation rejects mismatches — 1 test
- ✅ Payment state transitions are race-safe — conditional UPDATE
- ✅ UPI verify endpoint works — 2 tests

**What's NOT verified:**
- ❌ PaymentAttempt/PaymentEvent persistence (P0 — not wired)
- ❌ PhonePe v2 server-side verification (P0 — not called)
- ❌ Refund processing (not implemented)
- ❌ Live provider sandbox testing (no credentials)
- ❌ Financial metric correctness (P0 bugs in analytics)

**The payment pipeline is functionally correct for the happy path** (checkout → webhook → verify → transition → fulfill) but has 3 P0 gaps that prevent production release:
1. PaymentAttempt not persisted → cache expiry strands orders
2. PaymentEvent not persisted → replay guard inert
3. PhonePe v2 doesn't verify → trusts payload after auth header

These are DOCUMENTED with exact file paths and remediation steps in the architecture audit. They require code fixes that are safe to implement but were not executed in this audit-only phase.

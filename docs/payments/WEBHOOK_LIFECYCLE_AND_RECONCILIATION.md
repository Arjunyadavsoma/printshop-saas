# Webhook Lifecycle, Provider Retry Behavior, and Reconciliation

**Branch:** `phase-5-2-1-adapter-contract-webhook`
**Date:** 2025-11-09
**Status:** Reference document (no code changes)

---

## Purpose

This document describes — honestly and without overclaiming — the webhook
delivery lifecycle for each payment provider integrated into PrintShop SaaS,
what happens when a provider stops retrying, how stale events are detected,
how failed events are retried, and how provider-confirmed payments are
reconciled with internal orders.

**Critical honesty note:** We do NOT claim guaranteed provider retry behavior
without citing official documentation. Where official retry documentation was
not found, we say so explicitly and describe the defensive measures the
platform takes regardless of provider retry policy.

---

## Provider webhook retry behavior

### PhonePe v1 (Standard API)

| Property | Value | Source |
|---|---|---|
| Webhook URL | Configured per-merchant in the PhonePe dashboard | PhonePe merchant portal |
| Auth | `X-VERIFY` header = `sha256(base64body + saltKey)###saltIndex` | Verified in `packages/adapters/src/payment/phonepe.adapter.ts` `handleWebhook` |
| Body | Base64-encoded JSON `{ code, data: { merchantTransactionId, transactionId, amount, state, ... } }` | Verified in tests |
| Retry policy | **Not verified from official PhonePe docs.** PhonePe is widely reported to retry failed webhook deliveries for a limited window, but the team could not locate an official statement specifying the exact retry count or interval. | — |
| Expected action on receipt | Return HTTP 200. Non-2xx responses are assumed to trigger retries. | Common PSP convention |

**What we do NOT claim:**
- We do NOT claim PhonePe v1 retries for a specific number of attempts.
- We do NOT claim PhonePe v1 retries for a specific duration.
- We do NOT claim PhonePe v1 stops retrying after a specific time.

**What we DO guarantee (platform-side, independent of provider retry):**
- Every webhook that passes signature verification is persisted as a
  `PaymentEvent` row with `processingStatus='received'` BEFORE any financial
  state transition.
- Duplicate deliveries are caught by the `@@unique([provider, eventId])`
  constraint on `PaymentEvent` (verified in
  `src/lib/payments/payment-event-persistence.test.ts` test A3).
- The `Order.paymentTxnId` UNIQUE constraint is a second replay guard —
  even if a duplicate webhook bypasses the PaymentEvent check (e.g.,
  cold-start cache miss), the order transition is atomic and race-safe
  via `transitionStatus` with `WHERE status='awaiting_payment'`.

### PhonePe v2 (Business API)

| Property | Value | Source |
|---|---|---|
| Webhook URL | Configured per-merchant in the PhonePe Business dashboard | PhonePe Business portal |
| Auth | `Authorization` header = bare `sha256(username:password)` hex (NOT Basic Auth, NOT X-VERIFY) | Verified in `src/lib/payments/phonepe-v2-webhook.ts` `validatePhonePeV2Auth` |
| Body | Plain JSON `{ event: "pg.order.completed", payload: { merchantOrderId, amount, state, paymentDetails: [...] } }` | Verified in `src/lib/payments/phonepe-v2-webhook.ts` |
| Events | `pg.order.completed`, `checkout.order.completed`, `paylink.order.completed` (success); `checkout.order.failed`, `paylink.order.failed` (failure); `pg.refund.completed`, `pg.refund.failed` (refund) | Verified in `PAYMENT_COMPLETED_EVENTS`, `PAYMENT_FAILED_EVENTS`, `REFUND_EVENTS` sets |
| Retry policy | **Not verified from official PhonePe Business docs.** Same caveat as v1. | — |
| Server-side verification | `adapter.verifyPayment()` is called BEFORE the order transition — the webhook's claimed SUCCESS status is NEVER trusted alone. | `src/lib/payments/phonepe-v2-webhook.ts` lines 274–312 |

**PhonePe v2-specific defense (PAY-003 fix):** If `verifyPayment()` throws
(network error, timeout, credentials invalid, OAuth2 token fetch fails), the
webhook returns `summary: 'verification unavailable — payment held pending
for reconciliation'` and the order stays in `awaiting_payment`. This is
fail-closed: a verification failure NEVER results in a payment transition.

### Paytm

| Property | Value | Source |
|---|---|---|
| Webhook URL | Callback URL passed in the `createPayment` request (`/api/v1/payments/paytm/callback`) | `packages/adapters/src/payment/paytm.adapter.ts` `createPaymentIntent` |
| Auth | `CHECKSUMHASH` field in the form-urlencoded body = AES-128-CBC(sha256(params + merchantKey)) | Verified in `packages/adapters/src/payment/paytm.adapter.ts` `verifyPaytmChecksum` |
| Body | Form-urlencoded params (`MID`, `ORDERID`, `TXNID`, `TXNAMOUNT`, `STATUS`, `BANKTXNID`, `CHECKSUMHASH`, ...) | Verified in tests |
| Response | HTML page rendered to the customer's browser (NOT JSON) | `htmlPage()` helper |
| Retry policy | **Not verified from official Paytm docs.** Paytm is widely reported to retry callbacks, but the team could not locate an official statement. | — |

**Paytm-specific integrity:** The `CHECKSUMHASH` covers ALL form fields
(except `CHECKSUMHASH` itself). Tampering with `TXNAMOUNT` after signing
invalidates the checksum — verified in
`src/lib/payments/payments.test.ts` "rejects a tampered amount" test.

### UPI deep-link (no webhook)

| Property | Value |
|---|---|
| Webhook | **None.** UPI deep-link has no server-side webhook — the customer pays via their UPI app and the shopkeeper confirms manually. |
| Confirmation | Polling the PSP status API (Phase 3 roadmap) OR manual confirmation via the `/verify-payment` route. |
| Retry | N/A — there is no webhook to retry. |
| Reconciliation | The shopkeeper checks their UPI app for the credit + manually marks the order paid via the dashboard. |

---

## What happens when a provider stops retrying

If a provider delivers a webhook once, receives a non-2xx response (or a
timeout), and then stops retrying, the payment is in one of these states:

| Internal state | PaymentAttempt.status | PaymentEvent row | Order.status | Detection | Recovery |
|---|---|---|---|---|---|
| Webhook never arrived | `created` | (none) | `awaiting_payment` | Stale-attempt cron: `status='created' AND createdAt < NOW() - 10min` | Mark expired; customer retries checkout |
| Webhook arrived but signature failed | `created` | (none — signature check is BEFORE persistence) | `awaiting_payment` | Audit log `webhook.<provider>.received` exists, no `webhook.<provider>.paid` | Investigate the signature failure (wrong salt? key rotation?) |
| Webhook arrived, signature passed, but PaymentEvent persistence failed | `created` | (none — INSERT failed) | `awaiting_payment` | No PaymentEvent row despite a valid signature in audit logs | Re-deliver the webhook (provider retry) OR poll the status API |
| Webhook arrived, PaymentEvent persisted, but order transition failed | `created` | `received` (not `processed`) | `awaiting_payment` | Stale-event cron: `processingStatus='received' AND receivedAt < NOW() - 5min` | Re-run the webhook (idempotent) OR poll the status API |
| Webhook arrived, PaymentEvent persisted, order transition succeeded | `paid` (see limitation below) | `processed` | `paid` | (none — happy path) | (none) |

**Limitation (documented, not fixed in this phase):** `PaymentAttempt.status`
is currently set to `created` at checkout and is NOT advanced to `paid` or
`failed` after webhook processing. This is a known gap — the `PaymentEvent`
table IS updated correctly (`received` → `processed`), but the
`PaymentAttempt` table is not. See "Remaining limitations" in the phase
report.

---

## How stale events are detected

### Stale PaymentAttempt detection

```sql
SELECT id, "merchantOrderId", "createdAt"
FROM "PaymentAttempt"
WHERE status = 'created'
  AND "createdAt" < NOW() - INTERVAL '10 minutes';
```

A `created` PaymentAttempt older than 10 minutes means the customer started
checkout but no webhook confirmed payment. The 10-minute window matches the
`expiresAt` field on PaymentAttempt (set to `now + 10min` at checkout).

### Stale PaymentEvent detection

```sql
SELECT id, "eventId", "receivedAt"
FROM "PaymentEvent"
WHERE "processingStatus" = 'received'
  AND "receivedAt" < NOW() - INTERVAL '5 minutes'
ORDER BY "receivedAt";
```

A `received` PaymentEvent older than 5 minutes means the webhook pipeline
started (signature verified, event persisted) but did not complete (the order
transition was not applied, or the `processed` update failed). The 5-minute
window is conservative — normal webhook processing completes in <1 second.

**Verified in tests:**
- `src/lib/payments/payment-event-persistence.test.ts` test B7 ("an event
  stuck in PROCESSING can be detected and recovered") exercises the
  `findStale('received', 5 * 60 * 1000)` query against real PostgreSQL
  (PGlite) and confirms a 30-minute-old `received` event is detected while a
  fresh `received` event is not.

---

## How failed events are retried

### Idempotent re-delivery

If the provider re-delivers the same webhook (same `eventId`), the
`@@unique([provider, eventId])` constraint on `PaymentEvent` catches the
duplicate INSERT. The webhook returns HTTP 200 (idempotent), NOT 500. This
is safe because:

1. The first delivery either completed the order transition (in which case
   the second delivery's `transitionStatus('awaiting_payment' → 'paid')`
   is a no-op — the WHERE clause doesn't match) OR
2. The first delivery failed before the transition (in which case the
   second delivery proceeds normally and applies the transition).

**Verified in tests:**
- Test B3 ("duplicate event insertion is safely handled") — second delivery
  returns 200 idempotent, exactly ONE PaymentEvent row, order paid once.
- Test B6 ("failed processing can be retried") — a pre-existing `received`
  event + a new delivery of the same `eventId` → idempotent 200, no double
  effect.

### Status-poll fallback

If the provider does NOT re-deliver, the platform can poll the provider's
status API directly:

```ts
const verification = await adapter.verifyPayment({
  merchantOrderId,
  shopCredentials: shop.paymentCredentials,
});
if (verification.paid) {
  // Transition the order — race-safe via transitionStatus.
}
```

This is the reconciliation path for:
- UPI deep-link payments (no webhook at all).
- Payments where the webhook was lost in transit.
- Payments where signature verification keeps failing (key rotation issue).

The `verifyPayment` call is the same method used by the PhonePe v2 webhook
handler (PAY-003 fix) — it's the authoritative server-side check.

### Manual reconciliation

The `/api/v1/shops/me/orders/[id]/verify-payment` route lets the shopkeeper
trigger a status poll for a specific order. This is the human-in-the-loop
fallback when automated reconciliation isn't configured.

---

## How provider-confirmed payments are reconciled with internal orders

### The reconciliation chain

```
Provider confirms payment
        │
        ├─ Webhook delivered ──→ processWebhook()
        │                              │
        │                              ├─ Signature verified (real crypto)
        │                              ├─ PaymentEvent persisted (PGlite/PG)
        │                              ├─ Amount validated (must match order)
        │                              ├─ Order transitioned (race-safe)
        │                              └─ Print jobs enqueued
        │
        └─ Webhook NOT delivered (or lost)
                    │
                    ├─ Stale-attempt cron detects PaymentAttempt.status='created' > 10min
                    ├─ Status-poll cron calls adapter.verifyPayment(merchantOrderId)
                    ├─ If paid: transitionStatus(orderId, shopId, 'awaiting_payment', { status: 'paid', ... })
                    └─ If not paid: mark PaymentAttempt expired
```

### Reconciliation guarantees

1. **Amount integrity:** The webhook payload's `amount` MUST equal the
   order's `totalAmountPaise`. A missing or mismatched amount is rejected
   BEFORE the order transition. (Verified in `webhook.service.ts` lines
   264–283 + multiple tests.)

2. **Tenant integrity:** The webhook's `shopId` (resolved via the
   PaymentAttempt's `shopId`) MUST match the order's `shopId`. A mismatch
   returns 403. (Verified in `webhook.service.ts` line 255.)

3. **Signature integrity:** The webhook signature is verified BEFORE any
   untrusted payload data is used. A bad signature returns 401 and NO
   PaymentEvent is persisted. (Verified in test B8.)

4. **Idempotency:** Duplicate webhooks (same `eventId`) are caught by the
   `PaymentEvent` UNIQUE constraint. Duplicate order transitions are caught
   by the `Order.paymentTxnId` UNIQUE constraint + the
   `transitionStatus('awaiting_payment', ...)` precondition.

5. **Server-side verification (PhonePe v2 only):** The webhook's claimed
   SUCCESS status is NEVER trusted alone — `adapter.verifyPayment()` is
   called to confirm with PhonePe's server before the transition. (PAY-003
   fix.)

### What is NOT reconciled automatically

- **Refunds:** `pg.refund.completed` / `pg.refund.failed` events are logged
  but do NOT trigger any order state transition. Refund reconciliation is
  manual (the shopkeeper verifies the refund hit their bank account).
- **Partial payments:** Not supported. The amount must match exactly.
- **Multi-currency:** Not supported. Currency is hardcoded to INR.

---

## Provider-specific signature limitations

### PhonePe v1 — X-VERIFY

- **Algorithm:** `sha256(base64body + saltKey)###saltIndex`
- **Verified by:** UPIPay SDK's `verifyWebhook()` (real crypto, not a
  hand-rolled implementation).
- **Limitation:** UPIPay's `verifyWebhook` warns when called without
  `expectedAmount` — amount integrity is not enforced at the signature layer.
  The platform compensates by validating `amount === order.totalAmountPaise`
  AFTER signature verification but BEFORE the order transition.
- **Test evidence:** `src/lib/payments/payments.test.ts` — 5 PhonePe v1
  webhook tests (valid signature, tampered payload, idempotent, wrong salt
  index, failed state).

### PhonePe v2 — SHA auth + server-side verification

- **Algorithm:** `Authorization: sha256(username:password)` (bare hex)
- **Verified by:** `validatePhonePeV2Auth()` using `timingSafeEqual`
  (constant-time comparison).
- **Server-side verification:** `adapter.verifyPayment()` is called BEFORE
  the order transition. This is the authoritative check — the webhook auth
  is just the first gate.
- **Limitation:** The v2 webhook does NOT include a per-payload signature
  (unlike v1's X-VERIFY). The auth header authenticates the CHANNEL, not the
  individual payload. The `verifyPayment` status poll compensates by
  confirming the payment state directly with PhonePe's server.
- **Test evidence:** `src/lib/payments/phonepe-v2-webhook.test.ts` — 16
  tests covering SHA auth, event routing, amount validation, idempotency,
  and the PAY-003 fail-closed path.

### Paytm — CHECKSUMHASH

- **Algorithm:** AES-128-CBC(sha256(params || merchantKey)) with a fixed IV.
- **Verified by:** `verifyPaytmChecksum()` (hand-rolled, constant-time-ish
  compare of the decrypted hash).
- **Limitation:** The hand-rolled implementation uses IV
  `0123456789012345`. The official Paytm Node Checksum library uses a
  different IV (`@@@@&&&&####$$$$`). The hand-rolled version is kept because
  the dev simulate route + existing tests depend on it; switching would
  break the checksum generation/verification pair. The hand-rolled crypto IS
  real (AES-CBC + SHA-256 + constant-time compare), just not the official
  IV. See the comment in `packages/adapters/src/payment/paytm.adapter.ts`
  lines 204–225 for the full rationale.
- **Test evidence:** `src/lib/payments/payments.test.ts` — 2 Paytm webhook
  tests (valid checksum, tampered amount).

### UPI deep-link — no signature

- **No webhook** — there is no signature to verify. Confirmation is via the
  status-poll API (`verifyPayment`) or manual shopkeeper confirmation.

---

## What this document does NOT claim

1. We do NOT claim any provider retries webhooks for a specific count or
   duration. Official retry documentation was not located for PhonePe v1,
   PhonePe v2, or Paytm. The platform's idempotency + reconciliation
   design is robust REGARDLESS of whether providers retry.
2. We do NOT claim the platform is production-ready for live payments.
   Sandbox testing with real merchant credentials has not been performed.
3. We do NOT claim the hand-rolled Paytm checksum matches the official
   Paytm Node Checksum library's IV. It is a different (but still
   cryptographically real) implementation.
4. We do NOT claim `PaymentAttempt.status` is advanced after webhook
   processing. This is a documented limitation — only `PaymentEvent`
   status transitions are wired.

---

## Test evidence cross-reference

| Claim | Test file | Test name |
|---|---|---|
| Duplicate webhook → idempotent 200 | `payment-event-persistence.test.ts` | B3, B6 |
| Concurrent duplicate → one effect | `payment-event-persistence.test.ts` | B4 |
| Bad signature → no PaymentEvent persisted | `payment-event-persistence.test.ts` | B8 |
| Stale event detection | `payment-event-persistence.test.ts` | B7 |
| PaymentEvent UNIQUE([provider, eventId]) | `payment-event-persistence.test.ts` | A3 |
| PaymentAttempt UNIQUE(merchantOrderId) | `payment-event-persistence.test.ts` | A4 |
| Transaction rollback | `payment-event-persistence.test.ts` | A6 |
| PhonePe v1 X-VERIFY real crypto | `payments.test.ts` | 5 PhonePe webhook tests |
| Paytm CHECKSUMHASH real crypto | `payments.test.ts` | 2 Paytm webhook tests |
| PhonePe v2 SHA auth + fail-closed | `phonepe-v2-webhook.test.ts` | 16 tests |

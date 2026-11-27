# PRINTELYX — ToroPay API Contract

**Documentation source:** https://www.toropay.co.in/docs
**Payment status:** https://www.toropay.co.in/docs/payment-status
**Payment lifecycle:** https://www.toropay.co.in/how-payments-work
**Date:** 2026-11-27

> **CRITICAL:** This document distinguishes **verified facts** (from the task's supplied dashboard information) from **assumptions** (based on common UPI payment-link platform patterns). The assumptions MUST be reconciled with the latest official documentation before live use.

---

## Verified Facts (from supplied dashboard information)

### Webhook Contract

| Item | Value | Source |
|---|---|---|
| Signature header | `X-ToroPay-Signature` | Developer dashboard |
| Event type header | `X-ToroPay-Event` | Developer dashboard |
| Signature algorithm | HMAC SHA-256 | Developer dashboard |
| Signature input | Exact raw request body | Developer dashboard |
| Event envelope | `{ event_id, event_type, created_at, data }` | Developer dashboard |

### Event Types (verified from supplied examples)

| Event | Meaning | Printelyx action |
|---|---|---|
| `order.created` | ToroPay order created | Informational — no state change |
| `order.paid` | Order paid (direct UPI) | Pending merchant verification — NOT auto-finalized |
| `order.updated` | Order updated | Informational — no state change |
| `payment.confirmed` | Payment confirmed (provider checkout) | **Auto-finalize** — order transitions to paid |
| `payment.rejected` | Payment rejected | Mark payment as failed |
| `payment.paid` | Payment completed (direct UPI) | Pending merchant verification — NOT auto-finalized |
| `payment.failed` | Payment failed | Mark payment as failed |
| `payment_link.created` | Payment link created | Informational |
| `customer.created` | Customer created | Informational |
| `fulfillment.created` | Fulfillment created | Informational |
| `fulfillment.shipped` | Fulfillment shipped | Informational |
| `fulfillment.delivered` | Fulfillment delivered | Informational |

### Payment Modes

| Mode | Description | Verification |
|---|---|---|
| Direct UPI | Customer pays merchant's own UPI ID via payment link | Merchant must confirm receipt manually |
| Provider checkout | ToroPay orchestrates hosted checkout (Razorpay/Cashfree) | Signed `payment.confirmed` webhook auto-finalizes |

---

## Assumptions (NEED VERIFICATION against https://www.toropay.co.in/docs)

### API Base URL

**Assumed:** `https://api.toropay.co.in/v1`

**Verification needed:** Check the ToroPay developer dashboard or API documentation for the exact base URL and API version.

### Authentication

**Assumed:** `Authorization: Bearer <api_key>` header

**Verification needed:** Check whether ToroPay uses Bearer token, API key header, or another auth scheme.

### Create Order Endpoint

**Assumed:**
```
POST {base}/orders
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "merchant_order_id": "<our UUID>",
  "amount_paise": 50000,
  "currency": "INR",
  "customer": { "phone": "...", "name": "..." },
  "return_url": "https://...",
  "description": "Printelyx order <orderNumber>",
  "upi_id": "<merchant UPI ID>",
  "mode": "test"
}

Response:
{
  "id": "toropay_order_xxx",
  "checkout_url": "https://www.toropay.co.in/checkout/xxx",
  "amount_paise": 50000,
  "status": "created",
  "expires_at": "2026-..."
}
```

**Verification needed:**
- Exact endpoint path (`/orders` vs `/payment_links` vs `/links`)
- Request body field names (`amount_paise` vs `amount` vs `amount_in_paise`)
- Whether `upi_id` is a field or configured at the account level
- Response schema (field names for checkout URL, order ID, expiry)

### Status Lookup Endpoint

**Assumed:**
```
GET {base}/orders/{id}
Authorization: Bearer <api_key>

Response:
{
  "status": "paid" | "pending" | "failed",
  "payment": { "txn_id": "...", "amount_paise": 50000, "status": "confirmed" },
  "amount_paise": 50000
}
```

**Verification needed:**
- Whether a status lookup endpoint exists
- Exact endpoint path
- Response schema

### Refund Endpoint

**Assumed:**
```
POST {base}/payments/{paymentTxnId}/refund
Authorization: Bearer <api_key>

{
  "amount_paise": 50000,
  "reason": "Customer request"
}
```

**Verification needed:**
- Whether refunds are supported via API
- Whether refunds are only available for provider checkout payments (not direct UPI)
- Exact endpoint path and request schema

### Amount Format

**Assumed:** Integer paise (1 INR = 100 paise) — consistent with the existing Printelyx architecture.

**Verification needed:** Check whether ToroPay uses paise or rupees (float or integer). If rupees, the adapter must convert.

### Idempotency

**Assumed:** The `merchant_order_id` is used as the idempotency key — creating an order with the same `merchant_order_id` twice returns the same order.

**Verification needed:** Check whether ToroPay supports idempotency keys explicitly (e.g. an `Idempotency-Key` header) or via the `merchant_order_id` field.

### Rate Limits

**Assumed:** Standard REST rate limits.

**Verification needed:** Check the documentation for exact rate limit values and retry behavior.

---

## Implementation Status

| Capability | Verified | Implemented | Notes |
|---|---|---|---|
| Webhook signature verification | ✅ HMAC SHA-256 + raw body | ✅ `verifyToroPaySignature()` with `timingSafeEqual` | Verified from dashboard info |
| Webhook event parsing | ✅ Event envelope structure | ✅ `parseToroPayEvent()` | Verified from dashboard info |
| Event classification | ✅ Event types listed | ✅ `classifyToroPayEvent()` | payment.confirmed → auto-finalize; payment.paid → merchant verify |
| Create payment intent | ❌ API endpoint assumed | ✅ Implemented with assumed contract | Needs verification against docs |
| Status lookup | ❌ API endpoint assumed | ✅ Implemented with assumed contract | Needs verification against docs |
| Refund | ❌ Capability unknown | ✅ Implemented with error handling | Returns `failed` if unsupported |
| Duplicate webhook handling | ✅ UNIQUE constraint exists | ✅ Via `PaymentEvent @@unique([provider, eventId])` | Uses existing infrastructure |
| Atomic order finalization | ✅ `applyPaymentTransition()` exists | ✅ Via existing lifecycle service | No new code needed |
| Amount validation | ✅ Existing webhook pipeline | ✅ Via `processWebhook()` | Rejects mismatched amounts |
| Direct UPI vs provider checkout distinction | ✅ Documented | ✅ `settlementMode` in classification | Critical product distinction |

---

## Next Steps Before Live Use

1. **Visit https://www.toropay.co.in/docs** and verify every assumption marked above.
2. **Update the adapter** (`packages/adapters/src/payment/toropay.adapter.ts`) with the verified endpoint paths, field names, and response schemas.
3. **Update this document** with the verified facts, removing the "Assumed" markers.
4. **Run end-to-end tests** in test mode with real ToroPay test credentials.
5. **Verify webhook delivery** by creating a test payment and confirming the webhook arrives with a valid signature.
6. **Only then** switch `TOROPAY_MODE=live`.

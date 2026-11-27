# PRINTELYX — ToroPay API Contract (VERIFIED)

**Documentation sources:**
- API: https://www.toropay.co.in/docs/api-and-mcp
- Webhooks: https://www.toropay.co.in/docs/webhooks
- Payment status: https://www.toropay.co.in/docs/payment-status
- Getting started: https://www.toropay.co.in/docs/getting-started
- Payment links: https://www.toropay.co.in/docs/payment-links

**Date verified:** 2026-11-27
**All facts below are VERIFIED from the official ToroPay documentation.**

---

## API Base URL

**VERIFIED:** `https://www.toropay.co.in/api/v1`

All endpoints are under `/api/v1/` on the main `www.toropay.co.in` domain.

## Authentication

**VERIFIED:**
```
Authorization: Bearer tp_live_...    (live key)
Authorization: Bearer tp_test_...    (test key)
```

API keys are created in Dashboard → Developers. The raw key is shown once; only a hash is stored. Test keys can only act on the test workspace. Live keys work in live mode.

## Mode Header

**VERIFIED:**
```
x-toropay-mode: test    (or live)
```

API keys are bound to their own mode. Test keys can never act on live data.

## Scopes

**VERIFIED:**
- `read`: list transactions, links, orders, analytics, refunds, subscriptions, loyalty
- `write`: create links and orders, confirm or reject payments, record refunds

A request needing a scope the credential doesn't have returns 403.

## Endpoints (VERIFIED)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/transactions` | List transactions |
| POST | `/api/v1/transactions/{id}/confirm` | Merchant confirms a payment |
| POST | `/api/v1/transactions/{id}/reject` | Merchant rejects a payment |
| POST | `/api/v1/orders` | Create an order |
| GET | `/api/v1/orders/{id}` | Get order details |
| GET | `/api/v1/orders/{id}/payment-status` | Get payment status |
| GET/POST | `/api/v1/links` | List/create payment links |
| GET/POST | `/api/v1/refunds` | List/create refunds |
| GET | `/api/v1/subscriptions` | List subscriptions |
| GET/POST | `/api/v1/coupons` | List/create coupons |
| GET | `/api/v1/loyalty/{customer_id}` | Get loyalty info |
| GET | `/api/v1/analytics` | Get analytics |

---

## Webhook Contract (VERIFIED)

### Headers

| Header | Value |
|---|---|
| `X-ToroPay-Event` | Event type (e.g. `payment.confirmed`) |
| `X-ToroPay-Signature` | Hex HMAC-SHA256 of raw request body using endpoint secret |

### Payload

```json
{
  "id": "evt_...",
  "type": "payment.confirmed",
  "created_at": "2026-...",
  "data": { ... }
}
```

### Verification

1. Read raw body bytes BEFORE JSON parsing.
2. Compute HMAC-SHA256 of raw body using the webhook secret.
3. Compare with `X-ToroPay-Signature` header in constant time.
4. Reject if missing or mismatched.

### Events (VERIFIED)

| Event | Meaning | Printelyx action |
|---|---|---|
| `payment.confirmed` | Payment confirmed (merchant or provider) | **Auto-finalize order** |
| `payment.rejected` | Payment rejected by merchant | Mark payment failed |
| `payment.paid` | Legacy name for `payment.confirmed` | Auto-finalize |
| `payment.failed` | Legacy name for `payment.rejected` | Mark failed |
| `order.paid` | Order paid | Auto-finalize |
| `order.created` | Order created | Informational |
| `order.updated` | Order updated | Informational |
| `payment_link.created` | Payment link created | Informational |
| `customer.created` | Customer created | Informational |
| `fulfillment.created` | Fulfillment created | Informational (not used — pickup model) |
| `fulfillment.shipped` | Fulfillment shipped | Informational |
| `fulfillment.delivered` | Fulfillment delivered | Informational |

### Retries

A failed delivery is retried after 1, 5, 30, 120, 360, and 1440 minutes. After the sixth attempt, marked failed. Retries older than 48 hours are skipped. **Treat every delivery as retryable — dedupe on payload `id`.**

### Security Notes (VERIFIED)

- Only HTTPS endpoints accepted.
- Redirects are NOT followed (prevents signer bounce).
- Response body read up to 2,000 characters then discarded.
- Deliveries time out after 10 seconds.

---

## Payment Status Model (VERIFIED)

### Two pipelines

**Direct UPI (merchant-confirmed):**
```
Started (initiated)
  → Customer says paid (pending) — customer tapped "I have paid" (CLAIM, not proof)
  → Paid (success) — merchant confirmed money arrived
  → Rejected (failed) — merchant marked not received
```

**Hosted provider checkout (signed webhook):**
```
pending → processing → paid / failed / expired
  → Once paid: can only move to partially_refunded, refunded, disputed
```

### Who can change what

- A customer can only move Started → Customer says paid. They cannot settle.
- The owning merchant can confirm and can undo a confirmation for 30 minutes.
- An API key with `write` scope can confirm/reject via the v1 API.
- A signed provider webhook can settle a provider checkout, NEVER a direct UPI link.

### Critical invariants

- ToroPay does NOT mark a direct UPI payment paid on its own.
- ToroPay does NOT read the merchant's bank account.
- ToroPay does NOT move refunds (the merchant actions them off-platform).
- Late or out-of-order provider messages NEVER move a payment backwards.
- Webhook events are stored by provider event ID — duplicate delivery is ignored.
- Amount is checked against the order — a mismatch is flagged for review, NOT applied silently.

---

## Refunds (VERIFIED)

From docs: "ToroPay does not move refunds." The `POST /api/v1/refunds` endpoint **records** a refund for audit purposes, but the merchant must action the actual refund off-platform (via UPI directly). The refund record is tracked in the Printelyx `Refund` model with `provider: 'toropay'`.

---

## Implementation Status

| Capability | Verified | Implemented | Status |
|---|---|---|---|
| API base URL | ✅ `https://www.toropay.co.in/api/v1` | ✅ Hardcoded in adapter | **Verified** |
| Authentication | ✅ Bearer token | ✅ `Authorization: Bearer ${key}` | **Verified** |
| Mode header | ✅ `x-toropay-mode` | ✅ Included in all requests | **Verified** |
| Create order | ✅ `POST /api/v1/orders` | ✅ `createPaymentIntent()` | **Verified** |
| Payment status | ✅ `GET /api/v1/orders/{id}/payment-status` | ✅ `verifyPayment()` | **Verified** |
| Webhook signature | ✅ HMAC-SHA256 + constant-time | ✅ `verifyToroPaySignature()` | **Verified** |
| Webhook payload | ✅ `{ id, type, created_at, data }` | ✅ `parseToroPayEvent()` | **Verified** |
| Event classification | ✅ payment.confirmed = paid | ✅ `classifyToroPayEvent()` | **Verified** |
| Refund | ✅ Records only (no money movement) | ✅ `refund()` returns pending | **Verified** |
| Dedup | ✅ On payload `id` | ✅ Via `PaymentEvent UNIQUE` | **Verified** |
| Retries | ✅ 1/5/30/120/360/1440 min | ✅ Idempotent (dedup handles) | **Verified** |

**All API contract facts are now VERIFIED from official documentation. No assumptions remain.**

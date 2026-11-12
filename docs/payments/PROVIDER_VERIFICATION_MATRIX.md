# Phase 6.9 — Provider Verification Matrix

**Date:** 2026-11-10
**Scope:** For each payment provider integrated into PrintShop SaaS,
document what is VERIFIED (by tests + real API calls) vs. UNVERIFIED
(claimed by code but never exercised against the real provider's sandbox).

The four providers are registered in `src/lib/payments/registry.ts`:
PhonePe (v1 + v2 share one adapter), Paytm, and UPI deep-link (the
"zero onboarding" fallback).

| Provider | Adapter | Sandbox URL | Production URL |
|----------|---------|-------------|----------------|
| PhonePe v1 (Standard API) | `packages/adapters/src/payment/phonepe.adapter.ts` | `https://api-preprod.phonepe.com/apis/hermes` | `https://api.phonepe.com/apis/hermes` |
| PhonePe v2 (Business API, OAuth2) | same adapter, auto-detected by `clientId` | same hosts | same hosts |
| Paytm | `packages/adapters/src/payment/paytm.adapter.ts` | `https://securegw-stage.paytm.in` | `https://securegw.paytm.in` |
| UPI deep-link | `packages/adapters/src/payment/upi-deeplink.adapter.ts` | n/a (no server) | n/a |

---

## PhonePe v1 — Standard API

### Signature algorithm (VERIFIED by code + unit tests)

The PhonePe v1 callback uses the **X-VERIFY** header containing:
```
sha256(base64Body + "/pg/v1/status/" + merchantId + "/" + merchantTransactionId + saltKey)###saltIndex
```
…for status-checksummed requests, OR for **callback verification**:
```
sha256(base64Body + saltKey)###saltIndex
```

Implementation: `node_modules/upipay/dist/adapters/phonepe.js` →
`generateCallbackChecksum()`. Called by `PhonePePaymentAdapter.handleWebhook`
which delegates to `client.verifyWebhook(rawBody, signature, {enableReplayProtection: false})`.

Verified end-to-end in `src/lib/pricing/app-webhook-integration.test.ts`
scenario 1 — a forged-valid signature (computed with the shop's saltKey)
passes verification + the webhook pipeline transitions the order to 'paid'.
Scenario 10 verifies an invalid signature (wrong saltKey) is rejected
with HTTP 401 BEFORE reaching the lifecycle service.

### Idempotency mechanism (VERIFIED)

- **PaymentEvent UNIQUE([provider, eventId])** — DB-enforced. The
  `eventId` is the PhonePe `transactionId` (or fallback to
  `merchantOrderId`). Duplicate callbacks for the same transactionId hit
  the unique index → 23505 → lifecycle returns idempotent=true. Verified
  in `app-webhook-integration.test.ts` scenarios 4 + 5.
- **PaymentAttempt conditional updateMany** — `WHERE status IN ('created','pending')`.
  A duplicate callback for an already-paid attempt matches 0 rows →
  idempotent skip. Verified in scenario 12.
- **In-memory cache fast-path** — `pay:done:phonepe:{txnId}` key, 24h TTL.
  Catches the common case of a provider retrying within 24h without
  hitting the DB transaction. NOT verified against real PhonePe retries
  (no sandbox webhook delivery available in this environment).

### Retry behavior (PARTIALLY VERIFIED)

- **Provider-side retries:** PhonePe retries failed webhook deliveries
  for up to 24 hours (per PhonePe docs). Our idempotency guards (DB
  UNIQUE + conditional updateMany) handle this correctly — verified in
  scenarios 4 + 5.
- **Our retries:** the webhook endpoint returns 200 on success + on
  idempotent skips. It returns 500 only on lifecycle transition failure
  (rare — DB outage). The provider retries on 5xx. NOT verified against
  real PhonePe sandbox (no sandbox credentials available).

### Sandbox status (UNVERIFIED — credentials not configured)

The adapter supports sandbox mode via `env: 'sandbox'` in the shop's
`phonepe` credentials. However, **no real PhonePe sandbox credentials
are configured in this environment** — the adapter's `createPaymentIntent`
and `verifyPayment` paths have NOT been exercised against the PhonePe
preprod server. The unit tests verify the signature algorithm + the
adapter's plumbing, but the actual HTTP round-trip to PhonePe's API is
UNVERIFIED.

**Recommendation:** obtain PhonePe sandbox credentials
(`merchantId`, `saltKey`, `saltIndex`) + run an end-to-end test that:
1. Calls `createPaymentIntent` → gets a checkoutUrl.
2. Simulates the customer completing the payment on the PhonePe sandbox.
3. Receives the webhook → verifies signature → transitions order to paid.
4. Calls `verifyPayment` → confirms server-side status.

---

## PhonePe v2 — Business API (OAuth2)

### SHA authentication (VERIFIED by unit tests)

PhonePe v2 webhooks use a **bare SHA-256 hex** of `username:password` in
the `Authorization` header (NOT Basic Auth, NOT X-VERIFY). The handler
`src/lib/payments/phonepe-v2-webhook.ts` → `validatePhonePeV2Auth()`:
```ts
const expected = createHash('sha256').update(`${username}:${password}`).digest('hex');
return safeEqualHex(received, expected);  // timingSafeEqual
```
Verified in `src/lib/payments/phonepe-v2-webhook.test.ts` — accepts a
valid SHA header, rejects wrong username/password combinations.

### verifyPayment server-side check (VERIFIED by code, UNVERIFIED against sandbox)

The v2 webhook handler calls `adapter.verifyPayment({merchantOrderId, shopCredentials})`
BEFORE transitioning the order to 'paid' (PAY-003 fix). This is a
**defense-in-depth** check: even if the webhook signature is valid, the
handler doesn't trust the webhook's claimed SUCCESS status — it polls
PhonePe's `/pg/v2/status/{merchantId}/{merchantOrderId}` endpoint with
the OAuth2 Bearer token + confirms `code === 'PAYMENT_SUCCESS'`.

Code path verified in `src/lib/payments/phonepe-v2-webhook.ts` lines 278-312.
The OAuth2 token flow is implemented in `getOAuth2Token()` (lines 96-129)
with a per-process cache keyed by `clientId` (10-min TTL, refreshes 60s
before expiry).

**UNVERIFIED against sandbox:** the OAuth2 token endpoint
(`/oauth/v1/token`) + the status endpoint (`/pg/v2/status/...`) have NOT
been exercised against the PhonePe preprod server. The fail-closed path
(if `verifyPayment` throws or returns `paid=false`) IS verified by code
inspection — the order stays in 'awaiting_payment' for reconciliation.

### Retry behavior (PARTIALLY VERIFIED)

- **Idempotency:** same as v1 — PaymentEvent UNIQUE + conditional
  updateMany. Verified.
- **Cache fast-path:** `pay:done:phonepe:{txnId}` key. Verified.
- **Token refresh on 401:** NOT verified — the OAuth2 token cache
  doesn't have a 401-retry path. If PhonePe returns 401 on a status
  check (token expired between cache check + API call), the handler
  catches the error + fails closed (payment held for reconciliation).
  This is the SAFE behavior but may cause false-negative verifications
  during token rotation.

### Sandbox status (UNVERIFIED — credentials not configured)

The v2 path requires `clientId`, `clientSecret`, `clientVersion`, and
`merchantId`. No real v2 credentials are configured. The OAuth2 flow +
the `/pg/v2/pay`, `/pg/v2/status`, `/pg/v2/refund` endpoints are
UNVERIFIED.

**AUDIT-011 fix (Phase 6.6 P1):** previously, v2-credentialed shops
(without a saltKey) had webhooks accepted WITHOUT signature verification
(the adapter decoded the base64 payload directly). This was a P1 security
hole — an attacker who knew the order ID + amount could forge a webhook.
The fix: v2 shops MUST use the SHA auth path (`phonepe-v2-webhook.ts`),
NOT the v1 X-VERIFY path. The adapter's `handleWebhook` now rejects all
v2-credentialed webhooks that don't pass signature verification.

---

## Paytm

### CHECKSUMHASH algorithm (VERIFIED by known-vector unit tests)

Paytm callbacks use a **CHECKSUMHASH** field containing:
```
base64(AES-128-CBC(sha256(valuesPipeJoined + '|' + salt) + salt,
                    key=merchantKey.slice(0,16),
                    IV='@@@@&&&&####$$$$'))
```

Implementation:
- `generatePaytmChecksum()` in `packages/adapters/src/payment/paytm.adapter.ts`
  (mirrors the official Paytm Node Checksum library).
- `verifyPaytmChecksum()` — decrypts, splits hash (first 64 chars) + salt
  (last 4 chars), recomputes sha256, compares with `timingSafeEqual`.

Verified in `src/lib/payments/paytm-checksum.test.ts` against known
vectors. Production webhook verification delegates to `upipay`'s
`verifyWebhook` (which uses the same algorithm + handles form-urlencoded
parsing + CHECKSUMHASH extraction internally).

### Retry behavior (PARTIALLY VERIFIED)

- **Idempotency:** PaymentEvent UNIQUE([provider, eventId]) where
  `provider='paytm'` + `eventId=TXNID`. Verified generically in
  `app-webhook-integration.test.ts` scenarios 4 + 5 (provider-agnostic).
- **Paytm retry policy:** Paytm retries failed webhook deliveries for
  up to 7 days (per Paytm docs). Our idempotency guards handle this.
- **Status poll fallback:** `PaytmPaymentAdapter.verifyPayment` polls
  `/v3/order/status` via UPIPay. UNVERIFIED against Paytm staging.

### Sandbox status (UNVERIFIED — credentials not configured)

The adapter supports `env: 'sandbox'` (selects `https://securegw-stage.paytm.in`).
No real Paytm staging credentials are configured. The
`createPaymentIntent`, `verifyPayment`, and production `handleWebhook`
paths have NOT been exercised against the Paytm staging server.

The **dev simulate route** (`/api/v1/payments/dev/paytm/simulate`) uses
`generatePaytmChecksum` to sign a synthetic callback — this verifies the
checksum ALGORITHM end-to-end but does NOT verify the actual Paytm
gateway round-trip.

---

## UPI deep-link (the "zero onboarding" fallback)

### verifyPayment (STUB — manual confirmation required)

The UPI deep-link adapter (`packages/adapters/src/payment/upi-deeplink.adapter.ts`)
has a STUB `verifyPayment`:
```ts
async verifyPayment(input): Promise<PaymentVerification> {
  return { paid: false, txnId: null, utr: null, amountPaise: null, ... };
}
```
It always returns `paid=false`. **There is no server-side payment
verification for UPI deep-link.** Confirmation comes via:

1. **The customer's UPI app** paying into the shopkeeper's VPA
   (`shop.upiId`).
2. **The shopkeeper manually confirming** the payment arrived (via their
   UPI app's transaction history) + marking the order paid via the dev
   route `/api/v1/dev/orders/:id/mark-paid` OR the shopkeeper portal's
   "Verify Payment" button (which calls
   `/api/v1/shops/me/orders/:id/verify-payment`).

This is the **expected behavior** for the MVP — UPI deep-link is the
"zero onboarding" path for shopkeepers who haven't configured PhonePe or
Paytm. The shopkeeper is the human payment verifier.

### Manual confirmation required (VERIFIED)

- The `/api/v1/shops/me/orders/:id/verify-payment` route exists for the
  shopkeeper to manually mark an order paid after confirming the UPI
  credit in their app.
- The `/api/v1/dev/orders/:id/mark-paid` route exists for dev/demo
  purposes (gated behind `NODE_ENV !== 'production'`).
- The cron reconciliation job (`/api/v1/cron/reconcile-payments`) catches
  PaymentAttempts left in 'created' status past their 10-min expiry +
  marks them 'expired' so the customer can retry checkout.

### Retry behavior (N/A — no server-side webhook)

UPI deep-link has no server-side webhook. The customer either pays
(within 10 min) or doesn't. If they don't, the attempt expires + the
customer retries checkout (which mints a new PaymentAttempt with a
timestamp-suffixed merchantOrderId to avoid colliding with the expired
one — verified in `checkout-postgres-concurrency.test.ts` scenario 4).

### Sandbox status (N/A)

There is no sandbox — UPI deep-link is a client-side URI
(`upi://pay?...`) opened by the customer's UPI app. There's no server
API to test against.

---

## Summary matrix

| Provider | Signature algo | Idempotency | Retry handling | Sandbox verified? | Server-side verify? |
|----------|---------------|-------------|----------------|-------------------|---------------------|
| **PhonePe v1** | sha256(body+saltKey)###idx — **VERIFIED** (forged-valid sig in test 1, invalid sig in test 10) | DB UNIQUE + conditional updateMany — **VERIFIED** (tests 4, 5, 14) | 24h retry window handled idempotently — **PARTIALLY VERIFIED** (no real sandbox) | **NO** — no sandbox creds | Yes (`verifyPayment` via `/pg/v1/status`) — **UNVERIFIED** against sandbox |
| **PhonePe v2** | bare SHA-256(`user:pass`) hex — **VERIFIED** (unit tests) | Same as v1 — **VERIFIED** | Token cache + fail-closed on 401 — **PARTIALLY VERIFIED** | **NO** — no sandbox creds | Yes (`verifyPayment` via `/pg/v2/status` with OAuth2) — **UNVERIFIED** against sandbox. **Fail-closed verified by code inspection.** |
| **Paytm** | AES-128-CBC + SHA-256 + salt — **VERIFIED** (known-vector tests) | Same — **VERIFIED** | 7-day retry window — **PARTIALLY VERIFIED** | **NO** — no staging creds | Yes (`verifyPayment` via `/v3/order/status`) — **UNVERIFIED** against staging |
| **UPI deep-link** | N/A (no webhook) | PaymentAttempt expires after 10 min — **VERIFIED** | N/A (no server) | N/A | **STUB** — `verifyPayment` always returns `paid=false`. Manual confirmation required (shopkeeper marks paid via portal/dev route). |

## Honest gaps

1. **No provider sandbox credentials are configured in this environment.**
   All four adapters have their plumbing verified (signature algorithms,
   idempotency guards, fail-closed paths), but the actual HTTP round-trip
   to PhonePe/Paytm servers is UNVERIFIED. The production deploy MUST
   obtain sandbox credentials + run an end-to-end test before going live.

2. **The PhonePe v1 callback signature algorithm is verified only via a
   FORGED valid signature** (computed with the shop's saltKey that we
   seeded). A real PhonePe callback may use a slightly different payload
   structure (e.g. wrapper `{response: "<base64>"}` instead of bare
   base64). The adapter's `verifyWebhook` handles both formats (it tries
   `JSON.parse(rawBody)` to extract a `.response` field, falls back to
   treating the rawBody as the base64Response), but this is UNVERIFIED
   against real PhonePe callbacks.

3. **The PhonePe v2 OAuth2 token refresh-on-401 path is missing.** If
   PhonePe returns 401 on a status check (token expired between the
   cache check + the API call), the handler catches the error + fails
   closed. This is SAFE but may cause false-negative verifications
   during token rotation. Recommendation: add a 401-retry path that
   invalidates the cached token + retries once.

4. **The UPI deep-link adapter's `verifyPayment` is a STUB.** This is
   by design (no server API for UPI), but it means UPI payments require
   manual shopkeeper confirmation. The cron reconciliation job catches
   expired attempts, but there's no automated way to confirm a UPI
   payment was actually received. Future work: integrate with UPI
   Collection APIs (e.g. Razorpay UPI Collect, Cashfree UPI Intent)
   when the shopkeeper upgrades from the free tier.

5. **The provider-mismatch gap (scenario 9 in
   `app-webhook-integration.test.ts`)**: the lifecycle service does NOT
   validate that `input.provider === attempt.provider`. A Paytm webhook
   could transition a PhonePe attempt (and vice versa). This is a
   defense-in-depth gap — recommendation: add a provider-mismatch guard
   in `applyPaymentTransition` between STEP 1 and STEP 2.

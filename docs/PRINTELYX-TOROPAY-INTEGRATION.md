# PRINTELYX — ToroPay Integration Guide

**Provider:** ToroPay — https://www.toropay.co.in/
**Type:** UPI payment-link and checkout platform
**Integration date:** 2026-11-27

> **Important:** ToroPay is a UPI payment-link platform, NOT a conventional payment gateway. Money flows directly to the merchant's own UPI ID. A customer claiming to have paid is NOT proof of receipt. The merchant must confirm direct UPI payments.

---

## Account Setup

1. **Create a ToroPay account:** https://www.toropay.co.in/dashboard
2. **Complete merchant KYC** — provide business details, UPI ID, and bank account.
3. **Get API keys** from the developer dashboard: https://www.toropay.co.in/dashboard/developers
4. **Generate a webhook signing secret** in the developer dashboard.
5. **Register the webhook URL:** `https://<your-domain>/api/v1/payments/toropay/webhook`

## Test / Live API Key Setup

| Mode | `TOROPAY_MODE` | API Key | Purpose |
|---|---|---|---|
| Test | `test` | Test key from dashboard | Sandbox — no real money moves |
| Live | `live` | Live key from dashboard | Production — real UPI payments |

**Do NOT enable live mode until the full checkout flow is verified in test mode.**

## API Key Scopes

The ToroPay API key grants access to:
- Create payment links / orders
- Query payment status
- Initiate refunds (if supported by the account)
- Receive webhook events

The key is server-side only (`TOROPAY_API_KEY`). It is NEVER exposed to the browser. The webhook secret (`TOROPAY_WEBHOOK_SECRET`) is separate from the API key and is used only for HMAC SHA-256 signature verification.

## Webhook URL Registration

Register this URL in the ToroPay developer dashboard:
```
https://<your-domain>/api/v1/payments/toropay/webhook
```

The webhook handler:
1. Reads the raw request body (bytes BEFORE JSON parsing).
2. Verifies `X-ToroPay-Signature` (HMAC SHA-256) using `TOROPAY_WEBHOOK_SECRET` + `timingSafeEqual` (constant-time comparison).
3. Parses the event envelope: `{ event_id, event_type, created_at, data }`.
4. Classifies the event:
   - `payment.confirmed` → provider checkout settled → order auto-finalized.
   - `payment.paid` / `order.paid` → direct UPI → pending merchant verification.
   - `payment.rejected` / `payment.failed` → payment failed.
5. Validates amount, currency, and merchant order reference against the stored order.
6. Atomically transitions the PaymentAttempt + Order via `applyPaymentTransition()` (single PostgreSQL transaction).
7. Deduplicates via `PaymentEvent UNIQUE([provider, eventId])` + in-memory cache.

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TOROPAY_API_BASE_URL` | Yes | API base, e.g. `https://api.toropay.co.in/v1` (ASSUMED — verify in docs) |
| `TOROPAY_API_KEY` | Yes | Merchant API key from dashboard |
| `TOROPAY_WEBHOOK_SECRET` | Yes | HMAC SHA-256 signing secret for webhook verification |
| `TOROPAY_MODE` | Yes | `test` or `live` |
| `TOROPAY_RETURN_URL` | Recommended | URL the customer returns to after payment (e.g. `https://domain/o/{token}`) |

All variables are server-side only. No `NEXT_PUBLIC_` prefix. Fail-closed if credentials are missing.

## Test Mode Testing

1. Set `TOROPAY_MODE=test` and the test API key.
2. Create a test order via the Smart Print Studio checkout.
3. Verify the checkout URL is generated.
4. Complete the payment using the ToroPay test flow.
5. Verify the webhook arrives and the signature verifies.
6. Verify the order transitions correctly:
   - `payment.confirmed` → order auto-finalized (paid → queued).
   - `payment.paid` → order stays "pending merchant verification".
7. Verify duplicate webhooks are deduplicated (no double-finalization).

## Live Mode Activation Checklist

- [ ] Test mode fully verified (all scenarios pass).
- [ ] `TOROPAY_MODE=live` set.
- [ ] Live API key + webhook secret set in Vercel environment variables.
- [ ] Webhook URL registered in ToroPay live dashboard.
- [ ] Webhook signature verification confirmed with a live test event.
- [ ] Refund flow tested (if refunds are supported by the account).
- [ ] Monitoring alerts configured for webhook failures.
- [ ] Rollback plan documented (revert to `TOROPAY_MODE=test`).

## Payment State Explanation

### Direct UPI Path (default for most merchants)

```
Customer opens checkout
  → ToroPay creates a payment link showing the merchant's UPI ID
  → Customer pays via their UPI app
  → ToroPay sends payment.paid webhook
  → Order stays "pending merchant verification" (NOT auto-finalized)
  → Merchant checks their UPI app / bank statement
  → Merchant calls POST /api/v1/shops/me/orders/[id]/confirm-payment
  → Order transitions: payment_submitted → paid → queued → printing → ready → collected
```

**Critical:** The platform NEVER marks the order paid from the `payment.paid` webhook alone. The merchant MUST confirm. This is honest — a customer claiming to have paid is not proof.

### Provider Checkout Path (if enabled on the account)

```
Customer opens checkout
  → ToroPay orchestrates a hosted checkout (Razorpay/Cashfree)
  → Customer completes payment on the provider's checkout page
  → Provider settles via ToroPay
  → ToroPay sends payment.confirmed webhook (signed)
  → Printelyx verifies the signature + amount + order reference
  → Order auto-finalized: payment_submitted → paid → queued → printing
```

**Critical:** Only a signed `payment.confirmed` webhook auto-finalizes the order. The signature is verified with `timingSafeEqual` — no string comparison.

## Direct UPI Limitations

- The platform cannot verify that a direct UPI payment was actually received — only the merchant can.
- A customer can submit a forged UTR (12-digit number) — the shopkeeper's manual verification is the safety net.
- The `payment.paid` webhook from ToroPay indicates the customer completed the UPI flow, but it does NOT guarantee the money was received. The merchant must confirm.

## Provider Checkout Limitations

- Provider checkout may not be available on all ToroPay accounts — it depends on the merchant's KYC and account configuration.
- If provider checkout is not enabled, the direct UPI path is the only option.
- The `payment.confirmed` event is only sent for provider checkout payments — it is never sent for direct UPI.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `TOROPAY_API_KEY is not set` | Missing env var | Set `TOROPAY_API_KEY` in Vercel project settings |
| `Invalid signature` on webhook | Wrong webhook secret or body modified | Verify `TOROPAY_WEBHOOK_SECRET` matches the ToroPay dashboard; ensure the raw body is not modified by middleware |
| Order stuck in `payment_submitted` | Webhook not arriving or merchant hasn't confirmed | Check webhook URL is registered; use `GET /api/v1/cron/reconcile-payments` to poll status; merchant calls `confirm-payment` |
| Duplicate order finalization | Webhook delivered twice | `PaymentEvent UNIQUE([provider, eventId])` prevents this — the second delivery is a no-op |
| Amount mismatch | Customer paid wrong amount | Webhook handler rejects with 400; order stays in `payment_submitted` |

## Security Precautions

1. **Never expose `TOROPAY_API_KEY` or `TOROPAY_WEBHOOK_SECRET` to the browser.** No `NEXT_PUBLIC_` prefix.
2. **Never log complete authorization headers.** The webhook handler logs the event ID + type only.
3. **Raw body verification.** The webhook reads `req.text()` BEFORE JSON parsing so the signature covers exact bytes.
4. **Constant-time comparison.** `timingSafeEqual` prevents timing attacks on the signature.
5. **Fail-closed.** Missing `TOROPAY_WEBHOOK_SECRET` → webhook returns 503 (not a 200 with fake success).
6. **No stack traces in responses.** The webhook handler catches all errors and returns a generic message.
7. **Idempotent processing.** Duplicate webhooks are a no-op (UNIQUE constraint + cache).
8. **Amount validation.** The webhook validates the amount against the stored order total — a mismatch is rejected.

## Rollback Procedure

If ToroPay integration causes issues:

1. **Immediate:** Set `TOROPAY_MODE=test` (or unset `TOROPAY_API_KEY`) to disable live payments.
2. **Shop-level:** Change the affected shop's `paymentProvider` back to `googlepay` (direct UPI) or `razorpay` via `POST /api/v1/shops/me/payment-credentials/activate`.
3. **Code-level:** Revert the commit that added the ToroPay adapter. The adapter is registered in `registry.ts` — removing the registration line is sufficient to disable it without removing the code.
4. **Database:** No schema migration is required for rollback — the ToroPay adapter uses the existing `PaymentAttempt`, `PaymentEvent`, and `Order` models. No ToroPay-specific tables or columns exist.

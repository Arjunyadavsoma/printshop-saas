# ToroPay Webhook Verification

## Fixed in this audit
1. extractReference now has a 'toropay' branch (was missing — every webhook returned 400 before signature verification)
2. Event classification: ONLY payment.confirmed auto-finalizes (was: payment.paid/order.paid also auto-finalized — legacy events now informational)

## Verified correct
- HMAC-SHA256 over exact raw body (timingSafeEqual)
- Missing secret → 503 fail-closed
- Invalid signature → 400
- Amount validated against session + inside transaction
- Event dedup via PaymentEvent UNIQUE([provider, eventId])
- Tenant isolation via session lookup + shopId re-validation
- Secret env var distinct from webhook URL

## Known gaps
- Zero ToroPay webhook tests (root cause of D2)
- Payload currency not checked (hardcoded INR in pipeline)
- Single platform-wide secret (not per-shop)
- adapters package imports app alias @/lib/... (layering violation)

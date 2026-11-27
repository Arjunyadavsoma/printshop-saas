# Production Configuration

## ToroPay (REQUIRED for live payments)
- TOROPAY_API_KEY (verified working — live key tested)
- TOROPAY_MODE=live
- TOROPAY_RETURN_URL=https://printelyx.cc.cd/o/{token}
- TOROPAY_WEBHOOK_SECRET (the SIGNING SECRET from dashboard, NOT the webhook URL)
- Register webhook URL in ToroPay dashboard: https://printelyx.cc.cd/api/v1/payments/toropay/webhook

## Google OAuth (REQUIRED for Gmail connection — currently gives zero functionality)
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
- Google Cloud Console: enable Gmail API, OAuth consent screen, redirect URI
- Docs/PRINTELYX-GMAIL-OAUTH-SETUP.md for full setup

## Existing (already set)
- PAYMENT_ENCRYPTION_KEY (AES-256-GCM for credentials + OAuth tokens)
- DATABASE_URL (Postgres via Supabase)

## Database migrations
- 20261128000000_add_gmail_reconciliation (ShopGmailConnection + PaymentEvidence) — deployed via ensure script in vercel-build.sh

## NOT CONFIGURED / NOT REQUIRED
- Gmail ingestion: NOT IMPLEMENTED (no Gmail API calls exist in code)
- Pub/Sub: NOT IMPLEMENTED
- Scheduled Gmail polling: NOT IMPLEMENTED

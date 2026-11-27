# Gmail Ingestion Status

## Verdict: NOT IMPLEMENTED (OAuth-only scaffolding)

## What EXISTS
- Google OAuth 2.0 flow (connect/callback/disconnect/status routes) — SECURE
- Refresh token AES-256-GCM encrypted storage (ShopGmailConnection table)
- PaymentEvidence table (with uniqueness constraints)
- reconciliation.ts matching engine (dead code — zero callers)
- Status API endpoint (no UI consumer)

## What DOES NOT EXIST
- Gmail API client (zero gmail.googleapis.com calls in codebase)
- Email polling (no cron route touches Gmail)
- Email parsing (no parser exists)
- Sender allowlist (no code, no config)
- PaymentEvidence INSERT path (no code creates rows)
- reconcileEvidence caller (zero call sites)
- Shopkeeper Gmail connection UI
- refreshAccessToken caller (tokens stored but never used)

## Honest conclusion
Connecting Gmail gives the shopkeeper ZERO functionality. The advertised reconciliation feature in commit 81a59a1 does not exist end-to-end.

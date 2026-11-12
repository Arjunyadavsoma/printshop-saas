# Known Limitations

## External infrastructure requirements
1. **Redis/Upstash** — required for F-01 (shared cache, rate limiting, refresh tokens)
2. **Render** — required for F-03 (realtime Socket.IO service)
3. **PhonePe sandbox credentials** — required for provider certification
4. **Paytm sandbox credentials** — required for provider certification
5. **Staging deployment** — required for cron execution verification

## Implementation gaps
1. **F-08: Upload validation** — file signature verification not implemented
2. **F-12: Browser token storage** — httpOnly cookie migration not implemented
3. **F-14: Device token hashing** — hardcoded salt not replaced
4. **F-15: Financial reporting** — application-level aggregation not replaced with SQL
5. **F-17: Printer contract** — canonical pairing protocol not documented
6. **F-18: Mobile validation** — Indian mobile number validation not implemented
7. **Admin mutation APIs** — shop approval, suspension, subscription management not implemented

## Operational requirements
1. **GitHub PAT** — used in previous phases for pushing branches; NOT VERIFIED — owner must revoke
2. **TRUSTED_PROXY** — must be set in production for rate limiting to work behind Vercel
3. **CRON_SECRET** — must be configured independently from SETUP_KEY and ADMIN_ACCESS_KEY
4. **APP_BASE_URL** — must be set to the actual deployment URL
5. **DATABASE_URL** — must point to a PostgreSQL instance (not SQLite)

## Provider limitations
1. **UPI verifyPayment** — stub returns `{ paid: false }`; manual confirmation required
2. **PhonePe v2 webhook** — unverified branch removed; v2 shops must use SHA auth path
3. **Recovery worker** — WebhookInbox entries persisted but not automatically processed by cron

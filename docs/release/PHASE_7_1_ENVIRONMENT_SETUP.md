# Phase 7.1 — Environment Setup

## Required production environment variables

### Cache (F-01)
- `CACHE_PROVIDER=redis` (NOT `memory` in production)
- `UPSTASH_REDIS_REST_URL` — Upstash Redis REST URL
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis REST token

### Database
- `DATABASE_PROVIDER=prisma`
- `DATABASE_URL` — PostgreSQL connection string (NOT SQLite)

### Storage
- `STORAGE_PROVIDER=supabase` (or `s3`, `r2`)
- Storage-specific credentials

### Authentication
- `JWT_ACCESS_SECRET` — minimum 32 characters
- `JWT_REFRESH_SECRET` — minimum 32 characters
- `PAYMENT_ENCRYPTION_KEY` — base64-encoded 32-byte key

### Cron
- `CRON_SECRET` — independent from other secrets

### Admin
- `ADMIN_ACCESS_KEY` — independent from other secrets

### Realtime (F-03 — not yet fixed)
- `REALTIME_PROVIDER=socketio-relay`
- `REALTIME_EMIT_URL` — Render service URL (NOT localhost)

### Upload limits (F-08)
- `MAX_UPLOAD_SIZE_BYTES` — default 25MB
- `MAX_PAGE_COUNT` — default 500

## Development environment
- `CACHE_PROVIDER=memory` is allowed in development
- `STORAGE_PROVIDER=memory` is allowed in development
- `DATABASE_PROVIDER=memory` is allowed in development
- `PRINT_AGENT_DEMO=1` is allowed in development only

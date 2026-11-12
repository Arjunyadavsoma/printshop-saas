# Production Operations Runbook

## Deployment sequence

1. Set environment variables:
   - `DATABASE_URL` — PostgreSQL connection string
   - `ADMIN_ACCESS_KEY` — independent secret for admin endpoints
   - `CRON_SECRET` — independent secret for cron endpoints
   - `APP_BASE_URL` — public deployment URL
   - `TRUSTED_PROXY` — set to `vercel` for rate limiting behind Vercel proxy
   - `CACHE_PROVIDER` — set to `redis` (NOT `memory` in production)
   - `REDIS_URL` — Upstash Redis connection string
   - `STORAGE_PROVIDER` — set to `supabase` or `s3`
   - `REALTIME_PROVIDER` — set to `socketio-relay`

2. Apply database migrations:
   ```bash
   npx prisma migrate deploy
   ```

3. Build the application:
   ```bash
   bun run build
   ```

4. Deploy to Vercel (or other platform)

5. Verify deployment:
   - `GET /api/v1/health` — returns 200
   - `GET /api/v1/ready` — returns 200

## Migration commands

- **Deploy migrations:** `npx prisma migrate deploy`
- **Validate schema:** `npx prisma validate`
- **Generate client:** `npx prisma generate`
- **Check migration status:** `npx prisma migrate status`

## Cron endpoints

- `/api/v1/cron/reconcile-payments` — every 10 minutes (Vercel Cron)
- `/api/v1/cron/cleanup` — every 5 minutes (Vercel Cron)
- Both require `Authorization: Bearer <CRON_SECRET>` header

## Security checklist

- [ ] `ADMIN_ACCESS_KEY` set (independent from other secrets)
- [ ] `CRON_SECRET` set (independent from other secrets)
- [ ] `TRUSTED_PROXY` set to `vercel`
- [ ] `CACHE_PROVIDER` set to `redis` (not `memory`)
- [ ] `DATABASE_URL` points to PostgreSQL (not SQLite)
- [ ] `APP_BASE_URL` set to actual deployment URL
- [ ] GitHub PAT from previous phases revoked
- [ ] No demo credentials in production database

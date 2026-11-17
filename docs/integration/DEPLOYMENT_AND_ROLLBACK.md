# Deployment and Rollback Guide — Companion Integration

**Date:** 2026-11-16
**Protocol version:** 1

## Pre-Deployment Checklist

- [ ] Prisma schema validated (`bunx prisma validate`)
- [ ] Prisma client generated (`bunx prisma generate`)
- [ ] Migration SQL reviewed (`prisma/migrations/20251116000001_.../migration.sql`)
- [ ] Lint passes (`bun run lint`)
- [ ] Typecheck passes (`bun run typecheck`)
- [ ] Unit tests pass (`bun run test`)
- [ ] No secrets in diff (`git diff origin/main | grep -E "github_pat_|sk_live_|password"`)
- [ ] Build script reviewed (`scripts/vercel-build.sh`)

## Database Migration

### Migration: `20251116000001_add_pairing_tickets_and_device_commands`

**Type:** Additive (IF NOT EXISTS on all statements)
**Risk:** None — adds new tables + one column, no destructive changes

### Applying to Production

**Option A: Via Vercel build (automatic)**
The `vercel-build.sh` script runs `timeout 30 bunx prisma migrate deploy`. If the Supabase pooled connection supports it, migrations apply automatically. If it times out (Supabase PgBouncer limitation), the build continues and migrations must be applied manually.

**Option B: Manual (recommended for production)**
```bash
# Use the DIRECT (non-pooled) connection string from Supabase Dashboard
# → Settings → Database → Connection string → Direct
DATABASE_URL='postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres' \
bunx prisma migrate deploy
```

**Option C: Supabase SQL Editor**
Run the migration SQL directly in Supabase Dashboard → SQL Editor.

### Verifying Migration
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_name IN ('PairingTicket', 'DeviceCommand');

-- Check PrintAgent.isEnabled column exists
SELECT column_name FROM information_schema.columns WHERE table_name = 'PrintAgent' AND column_name = 'isEnabled';

-- Check _prisma_migrations record
SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '20251116000001%';
```

## Vercel Deployment

### Build Process
1. `bun install --frozen-lockfile`
2. `bash scripts/vercel-build.sh`:
   - `bunx prisma generate` (~2s)
   - `timeout 30 bunx prisma migrate deploy` (30s max, non-fatal)
   - `bunx next build` (~90s)
3. Deploy to production

### Environment Variables Required
| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection (pooled OK for runtime) |
| `JWT_ACCESS_SECRET` | Yes | JWT signing |
| `REALTIME_EMIT_SECRET` | Yes | Socket.IO relay auth |
| `STORAGE_PROVIDER` | Yes | `supabase` |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase storage access |
| `SUPABASE_STORAGE_BUCKET` | Yes | Storage bucket name |

## Rollback Procedure

### Code Rollback
1. Vercel Dashboard → Deployments → select previous deployment → "Instant Rollback"
2. Or: `git revert <commit> && git push origin main`

### Database Rollback
The migration is additive — rolling back the code does NOT require rolling back the database. The new tables (`PairingTicket`, `DeviceCommand`) and column (`PrintAgent.isEnabled`) are harmless if the code doesn't reference them.

If a database rollback IS required:
```sql
-- Safe to drop (no production data in these tables during initial deploy)
DROP TABLE IF EXISTS "DeviceCommand";
DROP TABLE IF EXISTS "PairingTicket";
ALTER TABLE "PrintAgent" DROP COLUMN IF EXISTS "isEnabled";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20251116000001_add_pairing_tickets_and_device_commands';
```

**Warning:** Only drop these tables if you're sure no companion devices have been paired. Once devices are paired, the `PairingTicket` and `DeviceCommand` tables contain operational data.

## Monitoring

### Post-Deployment Checks
1. Visit `https://printshop-saas-three.vercel.app/shop/devices` — should load
2. Click "Add Computer" — should generate pairing ticket
3. Verify API: `GET /api/v1/shops/me/devices` returns 200 with device list
4. Check Vercel runtime logs for errors

### Companion-Specific Endpoints
| Endpoint | Expected | Test |
|---|---|---|
| POST /companion/pairing/begin | 200 with ticket | `curl -X POST -H "Authorization: Bearer <jwt>" ...` |
| GET /shops/me/devices | 200 with device array | `curl -H "Authorization: Bearer <jwt>" ...` |
| GET /companion/commands | 200 with command array | `curl -H "Authorization: Bearer <device-token>" ...` |

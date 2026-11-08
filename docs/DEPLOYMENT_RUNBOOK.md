# Deployment Runbook

> How to deploy PrintShop SaaS to production. Step-by-step.

---

## 1. Architecture

| Component | Platform | URL |
|---|---|---|
| Web app + API | Vercel (Hobby, Mumbai region) | `https://printshop-saas-three.vercel.app` |
| Database | Supabase PostgreSQL (pooler :6543) | `duyharicyurufmsjyhgs.supabase.co` |
| Storage | Supabase Storage (bucket: `printshop-uploads`) | Same project |
| Realtime | Socket.IO mini-service (Render, not deployed) | `:3003` via Caddy `?XTransformPort=3003` |
| Cleanup cron | GitHub Actions (every 5 min) | Calls `/api/v1/cron/cleanup` |

---

## 2. Environment variables (required)

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel + local `.env` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Vercel | 64-hex-char access token signing secret |
| `JWT_REFRESH_SECRET` | Vercel | 64-hex-char refresh token signing secret |
| `PAYMENT_ENCRYPTION_KEY` | Vercel | 32-byte base64 AES-256-GCM key |
| `SUPABASE_URL` | Vercel | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | `sb_secret_...` (NOT the publishable key) |
| `APP_BASE_URL` | Vercel (in vercel.json env) | `https://printshop-saas-three.vercel.app` |
| `CRON_SECRET` | Vercel + GitHub secrets | Secret for cleanup cron endpoint |
| `PHONEPE_WEBHOOK_USERNAME` | Vercel (optional) | PhonePe v2 webhook auth |
| `PHONEPE_WEBHOOK_PASSWORD` | Vercel (optional) | PhonePe v2 webhook auth |
| `REALTIME_EMIT_SECRET` | Vercel (optional) | Socket.IO emit relay auth |

Generate secrets:
```bash
openssl rand -hex 32          # JWT secrets
openssl rand 32 | base64      # encryption key
```

---

## 3. Deploy process

### 3.1 Code deployment (automatic)

```bash
git push origin main
# Vercel auto-deploys on push to main
# Build: bash scripts/vercel-build.sh → prisma generate + next build
# Deploy time: ~2 minutes
```

### 3.2 Database migration (manual — when schema changes)

```bash
# 1. Backup
pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d).sql

# 2. Review the migration SQL
cat prisma/migrations/<migration-name>/migration.sql

# 3. Execute via Supabase SQL Editor
#    https://supabase.com/dashboard/project/duyharicyurufmsjyhgs/sql/new
#    Paste the SQL → click Run

# 4. Verify
curl -sS "https://printshop-saas-three.vercel.app/api/v1/db-health" | python3 -m json.tool
```

**⚠️ NEVER use `prisma migrate deploy`** — the init migration is SQLite SQL. Use `prisma db push` or the Supabase SQL Editor.

### 3.3 Environment variable changes

1. Go to Vercel → Project Settings → Environment Variables
2. Add/edit the variable
3. Click "Redeploy" (or push any commit to trigger rebuild)

---

## 4. Rollback

### 4.1 Code rollback

```bash
git revert <commit-hash>
git push origin main
# Vercel auto-deploys the revert
```

### 4.2 Database rollback

```bash
# Restore from backup
psql "$DATABASE_URL" < backup-YYYYMMDD.sql
```

Only for destructive migrations. Additive migrations don't need rollback.

---

## 5. Health checks

```bash
# Liveness
curl -sS https://printshop-saas-three.vercel.app/api/v1/health
# → {"success":true,"data":{"status":"ok"}}

# Readiness (DB + storage + cache)
curl -sS https://printshop-saas-three.vercel.app/api/v1/ready

# DB health (tables + connection + counts)
curl -sS https://printshop-saas-three.vercel.app/api/v1/db-health

# Shops API
curl -sS https://printshop-saas-three.vercel.app/api/v1/shops?limit=1
```

---

## 6. Cleanup cron setup

### 6.1 Set the secret

1. Generate: `openssl rand -hex 32`
2. GitHub → repo → Settings → Secrets → Actions → add `CRON_SECRET`
3. Vercel → Project Settings → Environment Variables → add `CRON_SECRET` (same value)
4. Redeploy

### 6.2 Verify

```bash
# Should return 200 (not 401)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://printshop-saas-three.vercel.app/api/v1/cron/cleanup
```

### 6.3 Manual trigger

GitHub → repo → Actions → "Cleanup Cron" → "Run workflow"

# Deploy — PrintShop SaaS

Production deployment runbook. The app is three pieces: the **Next.js web/API** (Vercel), the **realtime mini-service** (Render or any Node host — optional), and the **print-agent CLI** (the shop's PC). Plus a Neon PostgreSQL DB and the env vars.

---

## 0. Prerequisites

- A Neon PostgreSQL database (free tier: 0.5 GB storage, always-available with scale-to-zero).
- (Optional) a Cloudflare R2 bucket or Supabase Storage for file uploads.
- (Optional) an Upstash Redis instance for rate limiting + idempotency.
- A Vercel account (Hobby plan — free, no credit card required for personal use).

---

## 1. Neon PostgreSQL setup

### 1a. Install the Neon CLI

```bash
npm i -g neon@latest
neon --version  # verify: 8.x
```

### 1b. Authenticate

```bash
neon login
# A browser will open — complete the OAuth sign-in.
```

If browser auth isn't possible, use an API key:
```bash
# Get an API key from https://console.neon.tech → Account → API Keys
export NEON_API_KEY="<your-api-key>"
```

### 1c. Link the project (already done if `.neon` exists)

```bash
neon init -y \
  --org-id <your-org-id> \
  --project-id <your-project-id> \
  --branch production \
  --services postgres \
  --no-agent-setup
```

### 1d. Pull the connection string

```bash
neon env pull
# Writes DATABASE_URL=postgresql://... to .env
```

### 1e. Apply the schema + partial unique index

```bash
export DATABASE_URL="postgresql://..."  # from step 1d
bash scripts/pg-migrate-prod.sh
# Applies: 8 tables, 22 indexes (21 + 1 partial unique), 9 FKs, baseline migration record.
```

### 1f. Seed demo data (DEV ONLY — do NOT run in production)

```bash
# Only if NODE_ENV != production:
curl -X POST http://localhost:3000/api/v1/dev/seed
# Creates: 3 demo shops + admin@printshop.demo user.
# In production (NODE_ENV=production), this route returns 404.
```

---

## 2. Vercel deployment

### 2a. Push to GitHub

The Vercel deployment uses GitHub integration. Push the repo to GitHub first.

### 2b. Import on Vercel

1. Go to https://vercel.com → New Project → Import from GitHub.
2. Select the PrintShop repository.
3. The `vercel.json` config is auto-detected:
   - **Framework:** Next.js
   - **Build command:** `bash scripts/vercel-build.sh` (handles the SQLite→PostgreSQL Prisma provider switch)
   - **Install command:** `bun install --frozen-lockfile`
   - **Region:** `bom1` (Mumbai — optimal for India-focused app)

### 2c. Configure environment variables

In Vercel → Project → Settings → Environment Variables, set:

| Variable | Value | Environment |
|---|---|---|
| `DATABASE_URL` | `postgresql://...@neon.tech/...?sslmode=require` | Production |
| `DATABASE_PROVIDER` | `prisma` | All |
| `STORAGE_PROVIDER` | `r2` | Production |
| `R2_ACCOUNT_ID` | `<from Cloudflare>` | Production |
| `R2_ACCESS_KEY_ID` | `<from Cloudflare>` | Production |
| `R2_SECRET_ACCESS_KEY` | `<from Cloudflare>` | Production |
| `R2_BUCKET` | `printshop-prod` | Production |
| `CACHE_PROVIDER` | `redis` | Production |
| `REDIS_URL` | `<from Upstash>` | Production |
| `REDIS_TOKEN` | `<from Upstash>` | Production |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` | All |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` | All |
| `STORAGE_CAPABILITY_SECRET` | `openssl rand -hex 32` | All |
| `PAYMENT_ENCRYPTION_KEY` | `openssl rand 32 \| base64` | All |
| `REALTIME_PROVIDER` | `memory` | Production |
| `APP_BASE_URL` | `https://your-app.vercel.app` | Production |
| `NODE_ENV` | `production` | Production |

### 2d. Deploy

Click **Deploy**. Vercel runs:
1. `bun install --frozen-lockfile`
2. `bash scripts/vercel-build.sh` (switches Prisma to PostgreSQL, generates client, builds Next.js)
3. The app starts with `NODE_ENV=production` + the env vars from step 2c.

### 2e. Verify

```bash
# After deployment:
BASE_URL=https://your-app.vercel.app bash scripts/smoke-test.sh
```

The smoke test checks: health, ready, dev routes blocked, shops list, auth login, shopkeeper orders, admin shops.

---

## 3. Realtime service (optional)

The realtime mini-service provides live dashboard updates via socket.io. On Vercel, the app uses `REALTIME_PROVIDER=memory` (no live updates — the UI polls instead).

To enable live updates:
1. Deploy the realtime service to Render (Starter, $7/month):
   ```bash
   cd mini-services/realtime-service
   bun install
   bun index.ts  # runs on port 3003
   ```
2. Set `REALTIME_PROVIDER=socketio` + `REALTIME_EMIT_URL` + `REALTIME_EMIT_SECRET` in Vercel.

---

## 4. Print-agent (shopkeeper's PC)

The print-agent runs on the shopkeeper's computer, not in the cloud. See `/shop/printer` in the shopkeeper portal for installation instructions.

```bash
cd mini-services/print-agent
bun install
PRINT_AGENT_DEVICE_TOKEN=<token> PRINT_AGENT_API_URL=https://your-app.vercel.app bun src/index.ts start
```

---

## 5. Local development

```bash
# SQLite (default — no external services needed):
bun run dev

# With local PostgreSQL:
source scripts/pg-env.sh
bash scripts/pg-migrate-prod.sh
# Switch schema to postgresql + regenerate:
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
bunx prisma generate
bun run dev
```

---

## 6. Rollback

- **Vercel:** instant rollback via the Vercel dashboard (each deployment is immutable).
- **Neon:** use Neon's point-in-time restore (free tier: 7-day history).
- **Schema:** Prisma migrations are forward-only. For rollback, restore from a `pg_dump` taken before the migration.

---

## 7. Free-tier limits

| Service | Free tier | Limit |
|---|---|---|
| Neon PostgreSQL | 0.5 GB storage, 100 compute hours/month | Scale-to-zero (cold starts ~3s) |
| Vercel Hobby | 100 GB bandwidth, 1000 builds/month | Serverless function timeout 10s |
| Cloudflare R2 | 10 GB storage, 0 egress cost | 1M Class A ops/month |
| Upstash Redis | 500K commands/day, 256 MB | 1 concurrent connection |

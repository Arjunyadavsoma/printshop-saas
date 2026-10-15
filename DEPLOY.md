# Deploy — PrintShop SaaS

Production deployment runbook. The app is three pieces: the **Next.js web/API** (Vercel or Render), the **realtime mini-service** (Render or any Node host), and the **print-agent CLI** (the shop's PC). Plus a Postgres DB and the env vars.

---

## 0. Prerequisites

- A Postgres database (Supabase free 500MB, Neon, or self-hosted).
- (Optional) a Cloudflare R2 bucket for file storage.
- (Optional) an Upstash Redis for cache/queue/rate-limiting.
- (Optional) a Resend account for email.
- (Optional) a Sentry project for error tracking.

## 1. Set the production secrets

Generate strong secrets (never reuse the dev defaults — the container refuses to boot with them in production):

```bash
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
REALTIME_EMIT_SECRET=$(openssl rand -hex 32)
PHONEPE_SALT_KEY=<from PhonePe merchant dashboard>
PAYTM_MERCHANT_KEY=<from Paytm merchant dashboard>
```

## 2. Deploy the web + API → Vercel

```bash
# Install the Vercel CLI, link the project, set env vars, deploy.
vercel link
vercel env add JWT_ACCESS_SECRET production
vercel env add JWT_REFRESH_SECRET production
vercel env add DATABASE_URL production   # postgres://…
vercel env add DATABASE_PROVIDER production   # prisma
vercel env add APP_BASE_URL production       # https://your-app.vercel.app
vercel env add REALTIME_PROVIDER production   # socketio
vercel env add REALTIME_EMIT_URL production   # https://your-realtime.onrender.com/emit
vercel env add REALTIME_EMIT_SECRET production
vercel env add NODE_ENV production            # production
vercel --prod
```

`vercel.json` already sets security headers + the BOM region. On first deploy, run the DB migration:

```bash
DATABASE_URL=<prod-postgres> bun run db:push
DATABASE_URL=<prod-postgres> bun run scripts/seed.ts   # creates the demo shop + owner
```

## 3. Deploy the realtime mini-service → Render

```bash
# render.yaml defines the three services. Deploy:
render deploy --config render.yaml
```

Set in the Render dashboard:
- `JWT_ACCESS_SECRET` (same as the web app)
- `REALTIME_EMIT_SECRET` (same as the web app)

The mini-service runs `bun index.ts` on port 3003 (socket.io) + 3004 (/emit relay).

## 4. Deploy the print agent → the shop's PC

On the shop's Windows/Mac/Linux PC:

```bash
# Install bun, then:
cd print-agent && bun install
# Interactive setup (prompts for shop slug + owner login → mints a device token):
bun src/index.ts setup
# Run as a daemon (Windows: install as a service via node-windows; Mac/Linux: systemd/launchd):
bun src/index.ts start
```

For real printing (not demo): leave `PRINT_AGENT_DEMO` unset; install `pdf-to-printer` (Windows) or ensure CUPS `lp` is available (Mac/Linux). Set `PRINTER_NAME` to target a specific queue.

## 5. Post-deploy verification

```bash
# Health + readiness
curl https://your-app.vercel.app/api/v1/health
curl https://your-app.vercel.app/api/v1/ready
# Metrics
curl https://your-app.vercel.app/api/v1/metrics
# Login as the demo owner
curl -X POST https://your-app.vercel.app/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@quickprint.demo","password":"demo1234"}'
# The dev-only routes (/dev/seed, /payments/dev/*/simulate) return 404 in production.
```

## 6. Load test

```bash
k6 run load-test.js --env BASE_URL=https://your-app.vercel.app
# Target: 100 orders/min sustained, p95 < 2s, fail rate < 1%.
```

## 7. Monitoring

- **Sentry**: set `SENTRY_DSN` (the integration point in `toAppError` becomes live).
- **Logs**: structured JSON to stdout (Render/Vercel capture it; forward to Axiom/Logtail).
- **Uptime**: point Better Stack (free 10 monitors) at `/api/v1/health`.

---

## Production checklist

- [ ] `NODE_ENV=production` set
- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REALTIME_EMIT_SECRET` are strong (not dev defaults — the container fail-fast checks this)
- [ ] `DATABASE_URL` points at Postgres (not SQLite)
- [ ] `REALTIME_PROVIDER=socketio` + `REALTIME_EMIT_URL` points at the mini-service
- [ ] The realtime mini-service is running (dashboard "realtime connected" badge)
- [ ] At least one print-agent is registered + online (dashboard Settings → Print agents)
- [ ] `/dev/*` and `/payments/dev/*` routes return 404 (the `requireDev()` guard)
- [ ] Sentry DSN set (errors captured)
- [ ] Load test passes (100/min, p95 < 2s)
- [ ] The demo shop seeded (`scripts/seed.ts`) OR a real shop created via the owner dashboard

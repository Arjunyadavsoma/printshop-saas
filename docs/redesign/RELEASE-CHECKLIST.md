# Release Checklist — PrintShop Customer Redesign

## Pre-release

### Environment variables
- [ ] `DATABASE_URL` — PostgreSQL connection string (Supabase direct, not pooled, for migrations)
- [ ] `JWT_ACCESS_SECRET` — 32+ char random hex
- [ ] `JWT_REFRESH_SECRET` — different 32+ char random hex
- [ ] `PAYMENT_ENCRYPTION_KEY` — 32-byte base64 for AES-256-GCM
- [ ] `PRINTSHOP_WEB_URL` — the production URL (for the Android companion app)
- [ ] `OTP_ENABLED` — `false` (keep OTP off for initial release)
- [ ] `SENTRY_DSN` — error tracking (optional but recommended)

### Database migrations
- [ ] `prisma migrate deploy` on the production database (use direct connection, not pooled)
- [ ] Verify the `PasswordResetToken` table exists
- [ ] Verify the `_prisma_migrations` table is up to date

### Feature flags + defaults
- [ ] OTP: OFF (`OTP_ENABLED=false`)
- [ ] Dark mode: system preference (default)
- [ ] i18n: browser language detection (default English)
- [ ] Analytics: ON (privacy-friendly, no PII)
- [ ] Sensitive document toggle: available (customer-facing)
- [ ] Add-to-home-screen prompt: after 2nd order

### Security
- [ ] Gitleaks scan clean (run `gitleaks detect` on the release commit)
- [ ] No tokens/passwords in `.env` files committed to git
- [ ] CSP headers verified in production (`src/middleware.ts`)
- [ ] HSTS enabled
- [ ] All API routes use Zod validation
- [ ] Rate limiting active on all public endpoints

## Deploy

- [ ] Push to `main` (triggers Vercel deploy + GitHub Actions)
- [ ] Verify Vercel build succeeds
- [ ] Verify the Android APK build workflow succeeds
- [ ] Verify `/s/[shopSlug]` loads on the production URL
- [ ] Verify `/o/[token]` tracking works
- [ ] Verify `/orders`, `/help`, `/privacy` load

## Post-release monitoring (first 48 hours)

### Watch for
- [ ] **Funnel drop-offs by step** — check `/dev/funnel` or analytics. If > 50% drop at "upload", the upload UX is broken.
- [ ] **Payment waiting time** — if median time from "UTR submitted" to "payment confirmed" is > 5 min, the shopkeeper verification flow is slow.
- [ ] **Upload failures** — if > 10% of uploads fail, check the chunk upload + magic-byte validation.
- [ ] **Error rate** — check Vercel logs for 500 errors. If > 1%, investigate.
- [ ] **Lighthouse** — run Lighthouse on the production URL. Performance should be ≥ 90.

### Rollback steps
1. In Vercel: go to Deployments → find the last known-good deploy → click "Instant Rollback"
2. The previous deployment goes live immediately
3. Fix the issue on a branch → push → redeploy

### Customer support
- [ ] Monitor the `/help` page for common questions
- [ ] Watch for "I paid but it says pending" reports (expected behavior — shop needs to verify)
- [ ] Watch for "I can't find my order" reports (point them to `/orders` or the tracking link)

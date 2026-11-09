# Deployment & Rollback

> How PrintShop SaaS ships from `main` to production, how to roll it back, and
> the gates around migrations + secret rotation. Every claim is sourced from
> the actual repo.

---

## 1. Hosting topology

| Component | Platform | Region |
|---|---|---|
| Web app + API (Next.js 16) | Vercel Hobby, auto-deploy on push to `main` | `bom1` (Mumbai) — set in `vercel.json` |
| Database | Supabase PostgreSQL (pooler on port `6543`) | AWS ap-south-1 |
| Storage | Supabase Storage (bucket `printshop-uploads`) | same project |
| Realtime | Socket.IO relay (Render mini-service, currently not deployed) | n/a |
| Cleanup cron | GitHub Actions every 5 min → `/api/v1/cron/cleanup` | runs on `ubuntu-latest` |

Production URL: `https://printshop-saas-three.vercel.app` (hardcoded in
`vercel.json` env + `.env.example`).

---

## 2. Build pipeline

### 2.1 `vercel.json`

Key fields: `framework: nextjs`, `buildCommand: bash scripts/vercel-build.sh`, `installCommand: bun install --frozen-lockfile`, `regions: ["bom1"]`, and inline env block setting `APP_BASE_URL`, `DATABASE_PROVIDER=prisma`, `REALTIME_PROVIDER=memory`, `STORAGE_PROVIDER=supabase`, `CACHE_PROVIDER=memory`, `NEXT_PUBLIC_API_BASE=/api/v1`. Headers attach `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` on all routes.

Note: `CACHE_PROVIDER=memory` — rate limiting is per-invocation on serverless (Vercel Hobby). Acceptable for the pilot; DB UNIQUE constraints still guard payment idempotency. See `container.ts:137–153`.

### 2.2 `scripts/vercel-build.sh`

Two steps (lines 17–25):

```bash
bunx prisma generate    # reads prisma/schema.prisma — provider = postgresql
bunx next build         # output: "standalone" — produces .next/standalone/server.js
```

`next.config.ts` sets `output: "standalone"` so the server bundle is self-contained. The `package.json` `build` script (line 7) additionally copies `.next/static` and `public/` into the standalone dir — Vercel's buildCommand skips this because Vercel handles static assets itself.

### 2.3 CI gates (`.github/workflows/ci.yml`)

On every push / PR to `main`, the `validate` job runs in order: install (`bun install --frozen-lockfile`), Prisma generate, route-conflict check (`bash scripts/check-route-conflicts.sh` — catches two sibling `[slug]` dirs with different names, which crashes Next.js build), TypeScript (`npx tsc --noEmit`), ESLint (`bun run lint`), unit tests (`bunx vitest run`).

**Note:** `next.config.ts` has `typescript.ignoreBuildErrors: true` (line 7) — Vercel's build will succeed even with type errors. CI's `tsc --noEmit` is the **authoritative** type check. Do not rely on the build to catch type errors.

### 2.4 Cleanup cron (`.github/workflows/cleanup-cron.yml`)

Triggers: `cron: '*/5 * * * *'` (every 5 min UTC) + `workflow_dispatch: {}` (manual). Job: `curl -H "Authorization: Bearer $CRON_SECRET"` → `/api/v1/cron/cleanup`. Validates `CRON_SECRET` is set, calls the endpoint, parses the JSON, fails the workflow if `success != true`. The endpoint is idempotent + bounded (max 50 deletes per invocation, only deletes files with verified receipt + 15-min grace period elapsed).

---

## 3. Environment variables

### 3.1 Required (7)

| Variable | Purpose | Where to set |
|---|---|---|
| `DATABASE_URL` | `postgresql://...@db.xxx.supabase.co:6543/postgres?pgbouncer=true` | Vercel + local `.env` |
| `JWT_ACCESS_SECRET` | HS256 access token signing — `openssl rand -hex 32` | Vercel |
| `JWT_REFRESH_SECRET` | HS256 refresh token signing — different hex | Vercel |
| `PAYMENT_ENCRYPTION_KEY` | AES-256-GCM for payment credentials — `openssl rand 32 \| base64` | Vercel |
| `SUPABASE_URL` | `https://<project>.supabase.co` | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` (NOT the publishable key) | Vercel |
| `APP_BASE_URL` | `https://printshop-saas-three.vercel.app` | `vercel.json` env |

Container fails fast in production if any are missing or still a dev default (`container.ts:75–86` for secrets, `:100–106` for storage, `:113–125` for database, `:158–180` for encryption key).

### 3.2 Optional (2)

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | `openssl rand -hex 32` — authenticates the cleanup cron. Must be set identically in Vercel env vars AND GitHub repo secrets. Without it the cron workflow fails its own check. |
| `SETUP_KEY` | Bootstrap key for `/api/v1/db-health` + `/api/v1/setup-database`. Remove after initial setup. |

### 3.3 Provider switches (set in `vercel.json` env)

| Var | Default | Production |
|---|---|---|
| `DATABASE_PROVIDER` | `prisma` | `prisma` |
| `STORAGE_PROVIDER` | `memory` | `supabase` |
| `CACHE_PROVIDER` | `memory` | `memory` (Hobby) — or `redis` + Upstash creds for proper rate limiting |
| `REALTIME_PROVIDER` | `socketio` | `memory` (relay not deployed) |

Generate secrets: `openssl rand -hex 32` (JWT/cron/emit) and `openssl rand 32 | base64` (encryption). Never reuse a JWT secret for both access + refresh — `requireSecret('JWT_ACCESS_SECRET')` vs `requireSecret('JWT_REFRESH_SECRET')` are independent.

---

## 4. Deployment process

### 4.1 Standard deploy

```bash
git checkout main && git pull
git merge feature-branch      # or rebase
git push origin main          # Vercel auto-deploys
```

Vercel runs `scripts/vercel-build.sh` → `bunx prisma generate` + `bunx next build`. Build time on Vercel Hobby: ~3–5 min. Vercel assigns a new deployment URL (`printshop-saas-three-<commit>.vercel.app`) and re-points the production alias once build succeeds.

### 4.2 Verify a deployment

1. `curl /api/v1/health` → `200 { status: 'ok' }`.
2. `curl /api/v1/ready` → `200` with all `healthy: true`.
3. Smoke-test a shopkeeper flow: log in, load dashboard, load orders list.
4. Check structured logs in Vercel dashboard → filter by `service=printshop-api` → look for `level=error`.

Do not announce "deployed" until all 4 pass.

### 4.3 Promote a specific commit (rollback without revert)

If `main` is broken but the previous commit was healthy: Vercel dashboard → Deployments → find the last green deployment → `…` menu → **Promote to Production**. The production alias now points at the old build. Code on `main` is unchanged — you still need to fix main in a follow-up commit. This is the **fastest** rollback: < 1 min, no rebuild, no DB changes.

---

## 5. Rollback

### 5.1 Code rollback (when the bad commit is on main)

**Option A — Vercel instant promote (preferred, see §4.3):** promote the last-known-good deployment in the dashboard; then `git revert <bad-commit-sha>` on a feature branch → PR → merge to main; Vercel auto-deploys the revert; verify with `/api/v1/health`.

**Option B — git revert + push** (when Vercel dashboard isn't available):
```bash
git checkout main && git pull
git revert <bad-commit-sha>           # creates a revert commit
git push origin main                  # Vercel auto-deploys
```
Wait for build (~5 min) + verify `/api/v1/health`. Slower than Option A but works without dashboard access.

**Option C — force-push the prior SHA (emergency only):**
```bash
git checkout main && git reset --hard <last-good-sha>
git push --force origin main
```
Only use when a revert is too slow (e.g. a deploy is actively leaking data). Force-push rewrites history — coordinate with anyone else on the branch. After the emergency, **always** follow up with a clean revert commit so history is linear.

### 5.2 Database rollback (when a migration went bad)

Prisma migrations are applied by `scripts/pg-migrate-prod.sh` — **not** by Vercel's build. The Vercel build only runs `prisma generate` (client only); the DB schema is managed separately.

1. **Backup before any rollback** — Supabase dashboard → Database → Backups → restore point. Or: `pg_dump "$DATABASE_URL" --format=custom --file=backup-$(date +%Y%m%d).dump`
2. **Write the down-migration** — Prisma doesn't auto-generate down migrations. Hand-write the SQL to reverse the change (drop the new column, restore the old constraint, etc.).
3. **Apply via psql**: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/<ts>_rollback/down.sql`
4. **Verify** — `/api/v1/db-health?key=$SETUP_KEY` → check `tables`, `tablesCount`. Smoke-test affected routes.
5. **Restore from backup if SQL rollback fails**: `pg_restore --clean --if-exists --dbname="$DATABASE_URL" backup-YYYYMMDD.dump`

⚠️ **Never** roll back a migration that drops a column with live data without first exporting that data. `pg_dump --table=<table>` is cheap.

---

## 6. Migration approval gate

Any PR that touches `prisma/schema.prisma` or `prisma/migrations/` MUST follow this 4-step gate before merge:

### Step 1 — Backup

```bash
pg_dump "$DATABASE_URL" --format=custom --file=pre-migration-$(date +%Y%m%d-%H%M).dump
```
Or trigger a manual backup in the Supabase dashboard → Database → Backups.

### Step 2 — Compare

```bash
bunx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/migration-diff.sql
cat /tmp/migration-diff.sql     # review every ALTER TABLE statement
```

Look for:
- `ALTER TABLE … DROP COLUMN` — irreversible data loss. Confirm the column is unused (grep the codebase).
- `CREATE INDEX CONCURRENTLY` — preferred for non-blocking index adds on large tables. Prisma emits plain `CREATE INDEX`; hand-edit the SQL for shops with >10k orders.
- `ALTER TYPE` — enum changes can fail if a row has a value not in the new enum.

### Step 3 — Execute

For **dev / staging**: `bunx prisma migrate dev --name <descriptive-name>`.

For **production** (uses `scripts/pg-migrate-prod.sh`):
```bash
export DATABASE_URL="postgresql://…@db.xxx.supabase.co:6543/postgres?pgbouncer=true"
bash scripts/pg-migrate-prod.sh
```

The script refuses to run against a `file:` (SQLite) URL; generates postgresql-native DDL via `prisma migrate diff` (bypasses the committed SQLite migration that would otherwise fail with `type "datetime" does not exist`); applies the DDL idempotently (`CREATE TABLE IF NOT EXISTS`); applies `prisma/pg-constraints.sql` (partial unique indexes that Prisma can't express); records the baseline in `_prisma_migrations` so future `prisma migrate deploy` calls know the schema is already applied; verifies: 8 tables, 22 indexes, 9 FKs, 1 partial unique index.

### Step 4 — Verify

1. `/api/v1/db-health?key=$SETUP_KEY` → table count + row counts sane.
2. `/api/v1/ready` → `database.healthy: true`.
3. Smoke-test the affected flow (e.g. if you changed `Order`, hit `/api/v1/shops/me/orders`).
4. Watch structured logs for 10 min for `level=error` from any Prisma call.

Only after all 4 pass: merge the PR + push to main.

---

## 7. Secret rotation

### 7.1 JWT secrets (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`)

**Impact:** rotating either secret **invalidates every outstanding session immediately** — every shopkeeper's next request returns 401 until they re-login. Alert A3 (elevated 401s, see `MONITORING_AND_INCIDENT_RESPONSE.md`) will fire. Pre-warn users before a scheduled rotation.

**Steps:** generate `openssl rand -hex 32` for each (DIFFERENT values); update both in Vercel Project Settings → Environment Variables (Production); **redeploy** (Vercel does NOT pick up env-var changes without a redeploy — trigger via dashboard → Redeploy, or `git commit --allow-empty -m "rotate JWT secrets" && git push origin main`); verify with a test login (old tokens now 401); notify shopkeepers that they'll be logged out — support inbox may see "my session expired" reports for ~1 h.

### 7.2 `PAYMENT_ENCRYPTION_KEY`

⚠️ **Rotating this key without re-encrypting existing credentials makes them undecryptable.** All saved payment credentials in the `Shop.paymentCredentials` column are AES-256-GCM encrypted with this key.

**Steps:** write a migration script that reads each shop's `paymentCredentials` with the **old** key, decrypts, re-encrypts with the **new** key, and updates the row; run it (`bun run scripts/re-encrypt-credentials.ts` — not yet implemented, write it before rotating); update the Vercel env var + redeploy; smoke-test each shop's payment-credentials page (saved provider + keys must still be visible).

Do **not** rotate this key under time pressure. If you suspect it leaked, rotate it as part of a planned maintenance window with a tested re-encryption script.

### 7.3 `CRON_SECRET`

Generate `openssl rand -hex 32`; update in **both** Vercel env vars AND GitHub repo secrets (Settings → Secrets and variables → Actions). They must match — the GitHub Action sends it as `Authorization: Bearer`, the endpoint compares against `process.env.CRON_SECRET`; redeploy; trigger the workflow manually (`workflow_dispatch`) to verify.

### 7.4 Supabase service role key

If the `SUPABASE_SERVICE_ROLE_KEY` rotates (Supabase occasionally regenerates on project suspension/resume): Supabase dashboard → Settings → API → copy the new `service_role` secret; update Vercel env var + redeploy; `/api/v1/ready` should show `storage.healthy: true`; test file upload end-to-end (customer → upload → shopkeeper download).

---

## 8. Emergency contacts & ownership

| Layer | Owner |
|---|---|
| Vercel deployment | on-call engineer |
| Supabase DB + Storage | on-call engineer (Supabase dashboard access) |
| GitHub repo + Actions | on-call engineer (admin on the repo) |
| PhonePe merchant dashboard | business owner (webhook cred changes) |
| DNS / domain | DNS provider admin |

For a P1 incident that needs a deployment rollback + secret rotation simultaneously (e.g. confirmed credential leak), coordinate Vercel env-var updates + redeploy + a follow-up commit that rotates the code-side references in one window — partial rotation leaves the system in an inconsistent state.

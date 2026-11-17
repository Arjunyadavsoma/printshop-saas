# Operations Guide — printshop-saas

Internal operational reference. Do not publish real secret values anywhere;
every secret below is generated fresh per environment.

## Environments

| Environment | URL | Database | Notes |
|---|---|---|---|
| Local staging (this verification pass) | `http://localhost:3100` | disposable PostgreSQL, e.g. `postgresql://postgres@127.0.0.1:5433/phb_fresh` | production build (`next build` + `next start`), `STORAGE_PROVIDER=disabled` because no bucket credentials exist locally — upload endpoints fail explicitly |
| Production | `https://printshop-saas-three.vercel.app` | Supabase PostgreSQL | migrations applied manually (see below) |

## Environment variables (actual names read by the source)

Core: `DATABASE_URL`, `DATABASE_PROVIDER` (prisma|memory), `STORAGE_PROVIDER`
(supabase|s3|r2|disabled — memory is FATAL in production), `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`,
`STORAGE_CAPABILITY_SECRET` (dev in-memory signed URLs), `CACHE_PROVIDER`
(memory|redis + `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`),
`REALTIME_PROVIDER` (memory|relay), `REALTIME_EMIT_URL`, `REALTIME_EMIT_SECRET`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DEVICE_TOKEN_PEPPER`,
`PAYMENT_ENCRYPTION_KEY`, `PHONEPE_WEBHOOK_USERNAME`, `PHONEPE_WEBHOOK_PASSWORD`,
`APP_BASE_URL`, `CRON_SECRET`, optional `ADMIN_EMAIL`/`ADMIN_PASSWORD`,
`SETUP_KEY`, `ADMIN_ACCESS_KEY`, `TRUSTED_PROXY`, `CORS_ALLOWED_ORIGINS`,
`SENTRY_DSN`. See `.env.example`.

## Secret generation

```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, DEVICE_TOKEN_PEPPER, CRON_SECRET, REALTIME_EMIT_SECRET, STORAGE_CAPABILITY_SECRET
openssl rand 32 | base64   # PAYMENT_ENCRYPTION_KEY (32-byte AES key)
```

`DEVICE_TOKEN_PEPPER` is validated at startup: production boots FAIL without
it (≥16 chars). Development falls back to the legacy pepper so existing local
databases keep working.

## Database / migration procedure

1. NEVER run `prisma migrate deploy` against production without a pre-flight.
   Production schema was applied manually; use the baseline procedure:
   `npx prisma migrate resolve --applied <migration>` for each migration up to
   the last one verified applied, then `prisma migrate deploy` applies only the
   remainder (all migrations since `20251118000002` are idempotent/guarded).
2. Migrations `20251118000002` (token rotation columns) and
   `20251118000003` (FK/timestamp alignment) include header comments with the
   exact pre-flight orphan-check SQL for `20251118000003`.
3. Test every migration on a disposable PostgreSQL first. Verified
   2026-11-17: fresh deploy → `prisma migrate diff` vs schema.prisma reports
   no drift; history/baseline/data-integrity suites in
   `scripts/phase1/mig_test*` (agent sandbox) all converge with zero drift.
4. After deploying, confirm no drift:
   `npx prisma migrate diff --from-url <DB> --to-schema-datamodel prisma/schema.prisma`
   → must print "No difference detected."

## Device-token rotation lifecycle

- Verifiers are versioned: `v2:<hmac(DEVICE_TOKEN_PEPPER, token)>`; legacy
  bare-hex verifiers keep verifying until each device rotates.
- `POST /api/v1/companion/token/rotate` is the ONLY legacy→v2 migration path.
- During the 10-minute overlap the previous credential is restricted to
  heartbeat + read-only polling + rotation retry (403
  `TOKEN_OVERLAP_READ_ONLY` for mutations).
- Retirement of legacy verification after fleet migration:
  `SELECT count(*) FROM "PrintAgent" WHERE "tokenHash" NOT LIKE 'v2:%';` → 0.

## Realtime

Production currently runs `REALTIME_PROVIDER=memory` (publish is a no-op;
devices poll every 2–3 s). Deploying the Socket.IO mini-service
(`mini-services/realtime-service/`) and switching to `REALTIME_PROVIDER=relay`
is a pending decision — see docs/KNOWN_LIMITATIONS.md.

## Troubleshooting quick list

- 500 `STORAGE_PROVIDER=memory in production` → configure a real provider or
  `disabled` for storage-less staging.
- Boot failure `DEVICE_TOKEN_PEPPER must be set` → set the pepper env var.
- Device 403 `DEVICE_DISABLED` → shopkeeper re-enables from /shop/devices.
- Device 403 `TOKEN_OVERLAP_READ_ONLY` → device must complete rotation or
  re-pair (previous credential is read-only).
- 409 `ROTATION_CONFLICT` → concurrent rotation; retry with the current
  credential.

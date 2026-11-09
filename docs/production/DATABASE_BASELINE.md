# Database Baseline Procedure

Safe procedure for baselining Prisma migration history against the existing
production PostgreSQL database (Supabase) **without losing data**.

> Status: PROCEDURE DOCUMENTED — execute only after reading this file end-to-end.
> Audience: on-call engineer performing the first `prisma migrate` workflow on
> a production DB that was created via the `/api/v1/setup-database` endpoint.

---

## 1. Current production state

| Aspect | Value | Source |
| --- | --- | --- |
| Provider | PostgreSQL (Supabase pooler, port 6543) | `DATABASE_URL` |
| Tables | **14** business tables | `src/app/api/v1/setup-database/route.ts` `SETUP_SQL` |
| `_prisma_migrations` table | **DOES NOT EXIST** | confirmed via `information_schema.tables` |
| Init migration SQL | **SQLite dialect** (`DATETIME`, no `TIMESTAMP(3)`) | `prisma/migrations/20261015172034_init/migration.sql` |
| `migration_lock.toml` | `provider = "postgresql"` (correct) | `prisma/migrations/migration_lock.toml` |
| `PrintJob_active_file_unique` | EXISTS | created by setup endpoint line 39 + `prisma/pg-constraints.sql` |

### Why `prisma migrate deploy` fails today

The committed init migration (line 16 of `20261015172034_init/migration.sql`)
declares `"subscriptionExpiresAt" DATETIME` — a SQLite type. PostgreSQL
rejects this:

```
ERROR: type "datetime" does not exist
```

Running `prisma migrate deploy` against the production URL would:

1. Auto-create `_prisma_migrations`.
2. Attempt to apply `20261015172034_init` (the SQLite SQL).
3. Fail on the first `DATETIME` column.
4. Leave `_prisma_migrations` in an inconsistent state.

This is the trap. The 5-step procedure below avoids it.

---

## 2. The 5-step safe baseline procedure

### Step 1 — Backup

```bash
pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-owner --no-privileges \
  > backup-$(date +%Y%m%d-%H%M%S).sql
```

Verify the dump is non-empty and ends with `-- PostgreSQL database dump complete`.

### Step 2 — Compare schema (diff)

Generate the SQL needed to bring the live DB to the Prisma schema's state:

```bash
bunx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > drift-$(date +%Y%m%d).sql
```

- **Empty output** → schema matches; jump to Step 3.
- **Non-empty output** → see `docs/production/SCHEMA_DRIFT_REPORT.md` for the
  expected drift set (notably the `Subscription` table column drift). Apply
  each statement via Supabase SQL Editor **manually**, reviewing every line.
  Re-run Step 2 until the diff is empty.

### Step 3 — Create `_prisma_migrations` table

Run via Supabase SQL Editor (or `psql`):

```sql
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
);
```

This is the exact shape Prisma 6.x expects. Do **not** change column types.

### Step 4 — Resolve existing migrations as applied

Tell Prisma "these migrations are already on the DB — do not re-apply":

```bash
bunx prisma migrate resolve --applied 20261015172034_init
bunx prisma migrate resolve --applied 20251108000000_add_delivery_and_sync
```

If a `PaymentAttempt` / `PaymentEvent` migration existed, resolve it too —
currently those models exist only in `schema.prisma` + setup SQL, with no
committed migration folder, so nothing to resolve for them.

`migrate resolve` writes one row per migration into `_prisma_migrations`
with `finished_at = now()`. It does **not** execute SQL.

### Step 5 — Verify

```bash
bunx prisma migrate status
# Expected: "Database schema is up to date!"
```

Manual check (Supabase SQL Editor):

```sql
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations ORDER BY finished_at;
-- Expect 2 rows, both with finished_at set, rolled_back_at NULL.

SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public' AND table_name NOT LIKE 'sqlite_%';
-- Expect 15 (14 business + _prisma_migrations).

SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND indexname='PrintJob_active_file_unique';
-- Expect 1 row.
```

---

## 3. Post-baseline guardrails

After Step 5 succeeds:

- **Never** run `prisma db push` in production again — it bypasses the
  migration history. See `POSTGRESQL_MIGRATION_RUNBOOK.md`.
- **Never** run `prisma migrate reset` — it drops all data.
- Future schema changes: `bunx prisma migrate dev --name <description>`
  locally, then `bunx prisma migrate deploy` in production.
- The committed `20261015172034_init/migration.sql` (SQLite SQL) is **kept
  as-is** — Prisma uses only the migration *name* + checksum for history,
  not the SQL body, once resolved.

---

## 4. Rollback (if Step 2 drift was mis-applied)

```bash
psql "$DATABASE_URL" < backup-YYYYMMDD-HHMMSS.sql
DROP TABLE IF EXISTS _prisma_migrations;
```

The backup is the only recovery path. Additive drift-fixes (ALTER TABLE ADD
COLUMN) cannot be reversed without the dump — see
`DATABASE_BACKUP_AND_RECOVERY.md` § "Rollback limitations".

---

## 5. Reference files

- `prisma/schema.prisma` — canonical 14-model schema (PostgreSQL provider)
- `prisma/migrations/migration_lock.toml` — locks provider to `postgresql`
- `prisma/migrations/20261015172034_init/migration.sql` — SQLite SQL (do not run)
- `prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql` — PG-safe additive
- `prisma/pg-constraints.sql` — partial unique indexes not expressible in Prisma
- `src/app/api/v1/setup-database/route.ts` — `SETUP_SQL` constant
- `scripts/pg-migrate-prod.sh` — alternative auto-baseline (baselining via `migrate diff`)

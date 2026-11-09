# PostgreSQL Migration Runbook

Step-by-step runbook for managing the PrintShop production PostgreSQL schema
across three scenarios: fresh DB, existing baseline, and future migrations.

> Audience: any engineer running `prisma migrate` or `psql` against the
> Supabase production database. Read `DATABASE_BASELINE.md` first.

---

## 0. Constants

| Constant | Value |
| --- | --- |
| Production provider | PostgreSQL (Supabase) |
| `DATABASE_URL` format | `postgresql://user:pass@db.<project>.supabase.co:6543/postgres` |
| Expected table count | 14 business + `_prisma_migrations` (post-baseline) |
| Migration history (committed) | `20261015172034_init`, `20251108000000_add_delivery_and_sync` |

---

## 1. Scenario A — Fresh database setup

For a brand-new Supabase project (or any empty PostgreSQL DB) where no
tables exist yet.

### A.1 — Verify the DB is empty

```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public';
-- Must return 0.
```

### A.2 — Run the setup endpoint

```bash
curl -X POST "https://<your-domain>/api/v1/setup-database?key=$SETUP_KEY"
```

This executes the `SETUP_SQL` constant in
`src/app/api/v1/setup-database/route.ts` (idempotent — every statement uses
`IF NOT EXISTS`). It also creates the partial unique index
`PrintJob_active_file_unique` (line 39).

Expected response:

```json
{ "success": true, "data": { "statementsExecuted": <N>, "next": "..." } }
```

### A.3 — Apply partial-unique constraints

The setup endpoint already creates `PrintJob_active_file_unique`. For the
second partial unique (`Order_shop_tokenNumber_unique`), apply
`prisma/pg-constraints.sql`:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/pg-constraints.sql
```

### A.4 — Baseline the migration history

Follow `DATABASE_BASELINE.md` § 2 (Steps 3–5). For a fresh DB, Step 2 (diff)
should be empty or near-empty.

### A.5 — Verify

```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public' AND table_name != '_prisma_migrations';
-- Expect 14.

SELECT migration_name, finished_at FROM _prisma_migrations;
-- Expect 2 rows.
```

---

## 2. Scenario B — Existing database baseline

For the current production DB: 14 tables exist, created by the setup
endpoint, but `_prisma_migrations` does **not** exist.

Follow `DATABASE_BASELINE.md` § 2 in full:

1. `pg_dump` backup.
2. `prisma migrate diff` — apply drift manually if non-empty
   (see `SCHEMA_DRIFT_REPORT.md`).
3. Create `_prisma_migrations` (exact schema from `DATABASE_BASELINE.md`).
4. `prisma migrate resolve --applied <name>` for each committed migration.
5. `prisma migrate status` — must report up-to-date.

**Do not** skip Step 2 — the live DB has known drift on the `Subscription`
table that must be reconciled before `migrate resolve` is run.

---

## 3. Scenario C — Future migrations

**After** the baseline is recorded (Scenario A.4 or B complete), every
schema change follows the standard Prisma workflow:

### C.1 — Local development

```bash
# Edit prisma/schema.prisma (add model / column / index).
bunx prisma migrate dev --name <short_description>
```

This:
- Generates a new `prisma/migrations/<timestamp>_<name>/migration.sql`.
- Applies it to the local dev DB.
- Updates `prisma/migration_lock.toml` (already `postgresql`).

### C.2 — Review the generated SQL

Open the new `migration.sql`. Confirm:
- All timestamp columns use `TIMESTAMP(3)`, not `DATETIME`.
- No `db push` artefacts.
- For new partial-unique constraints, add them to
  `prisma/pg-constraints.sql` (Prisma can't emit partials).

### C.3 — Commit & deploy

```bash
git add prisma/migrations/<timestamp>_<name>/ prisma/schema.prisma
git commit -m "db(migration): <description>"
```

In production (Vercel build does **not** auto-migrate — run manually):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f prisma/migrations/<timestamp>_<name>/migration.sql
# Then update partial-unique constraints if changed:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/pg-constraints.sql
```

Or, if `DATABASE_URL` is reachable from your machine:

```bash
bunx prisma migrate deploy
```

`migrate deploy` will read `_prisma_migrations`, see the new entry as
pending, and apply it. This is safe **post-baseline**.

### C.4 — Verify post-deploy

```bash
bunx prisma migrate status
# "Database schema is up to date!"
```

---

## 4. What NEVER to do

These actions will either corrupt data, drop tables, or break the migration
history. Memorize them.

### 4.1 — NEVER run `prisma migrate deploy` with the committed SQLite migration

The committed `prisma/migrations/20261015172034_init/migration.sql` uses
SQLite types (`DATETIME`, no `TIMESTAMP(3)`). On a non-baselined PostgreSQL
DB, `migrate deploy` will fail mid-stream with
`ERROR: type "datetime" does not exist` and leave `_prisma_migrations` in an
inconsistent state.

The `migration_lock.toml` already says `provider = "postgresql"` — that
prevents Prisma from regenerating the migration as SQLite, but it does
**not** rewrite the already-committed SQL body. The body must stay SQLite
for historical integrity; the baseline procedure (`DATABASE_BASELINE.md`)
bridges the gap.

### 4.2 — NEVER run `prisma db push --accept-data-loss`

`db push` bypasses the migration history entirely. With
`--accept-data-loss`, Prisma will:
- Drop columns/tables that don't match `schema.prisma`.
- Drop indexes it doesn't know about (including
  `PrintJob_active_file_unique` and `Order_shop_tokenNumber_unique` —
  the partial uniques from `pg-constraints.sql`).
- Write nothing to `_prisma_migrations`, so the next `migrate deploy`
  will try to re-apply everything.

Even without `--accept-data-loss`, `db push` is forbidden in production
because it can't be rolled back via the migration history.

### 4.3 — NEVER run `prisma migrate reset`

`migrate reset` drops **every** table in the schema (including
`_prisma_migrations`), then re-applies every migration from scratch. On
production data this is catastrophic and unrecoverable without a backup.

If you find yourself reaching for `reset`, the correct action is usually
`migrate resolve --rolled-back <name>` for a single bad migration, followed
by a manual fix-up SQL.

### 4.4 — NEVER edit a committed migration's SQL body

Once a migration folder is committed and applied to any environment, its
`migration.sql` is immutable history. If you need to fix a mistake, create
a new migration (`migrate dev --name fix_<thing>`) that ALTERs the broken
state. Editing history causes checksum mismatches and forces `reset`.

### 4.5 — NEVER delete `prisma/pg-constraints.sql` from the deploy path

The partial unique indexes enforce:
- At most one **active** PrintJob per file (TOCTOU race guard).
- At most one Order per shop per non-null `tokenNumber` (race-safe allocation).

Without these, two concurrent webhook deliveries can both insert PrintJobs
for the same file, breaking the print-job idempotency invariant.

---

## 5. Quick reference — command safety matrix

| Command | Local dev | Staging | Production |
| --- | --- | --- | --- |
| `prisma migrate dev` | ✅ | ⚠️ (use `migrate deploy`) | ❌ |
| `prisma migrate deploy` | ✅ | ✅ | ✅ (post-baseline only) |
| `prisma migrate resolve` | ✅ | ✅ | ✅ (baseline only) |
| `prisma migrate status` | ✅ | ✅ | ✅ (read-only, safe) |
| `prisma migrate diff` | ✅ | ✅ | ✅ (read-only, safe) |
| `prisma db push` | ✅ | ⚠️ | ❌ |
| `prisma db push --accept-data-loss` | ⚠️ | ❌ | ❌ NEVER |
| `prisma migrate reset` | ✅ | ❌ | ❌ NEVER |
| `curl /api/v1/setup-database` | ✅ | ✅ | ✅ (idempotent, fresh DBs only) |

---

## 6. Related docs

- `DATABASE_BASELINE.md` — the 5-step baseline procedure
- `DATABASE_BACKUP_AND_RECOVERY.md` — `pg_dump` + recovery
- `SCHEMA_DRIFT_REPORT.md` — known drift between Prisma schema and setup SQL
- `scripts/pg-migrate-prod.sh` — automated baseline via `migrate diff`

# Database Backup and Recovery

Backup, recovery, and rollback procedures for the PrintShop production
PostgreSQL database (Supabase).

> Audience: on-call engineer. Read end-to-end before an incident.
> Related: `DATABASE_BASELINE.md`, `POSTGRESQL_MIGRATION_RUNBOOK.md`.

---

## 1. Backup procedure

### 1.1 — Pre-deploy backup (mandatory)

Run before **every** schema-changing operation (migration apply,
`pg-constraints.sql` apply, manual ALTER, baseline procedure).

```bash
# Use the pooled URL for connection reliability, OR the direct URL for
# long-running dumps. Prefer direct (port 5432) for backups > 100 MB.
BACKUP_FILE="backup-$(date +%Y%m%d-%H%M%S).sql"
pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-owner --no-privileges \
  --verbose \
  > "$BACKUP_FILE" 2> "$BACKUP_FILE.log"

# Sanity check.
test -s "$BACKUP_FILE" || { echo "FATAL: dump empty"; exit 1; }
tail -1 "$BACKUP_FILE"   # expect: "-- PostgreSQL database dump complete"
ls -lh "$BACKUP_FILE"
```

Upload the dump to offline storage (Google Drive / S3 / 1Password vault) —
do not keep the only copy on the same machine that runs migrations.

### 1.2 — Scheduled backup (recommended)

Supabase provides daily automatic backups on Pro plan and above. Confirm
the project's backup retention in the Supabase dashboard under
**Database → Backups**.

For an additional layer, schedule a weekly `pg_dump` via Vercel Cron or a
GitHub Action (the dump can be committed to a private gist for small DBs;
use object storage for > 50 MB).

### 1.3 — What the backup contains

`pg_dump --format=plain` produces a single SQL file with:
- `CREATE TABLE` statements (with `IF NOT EXISTS` semantics on restore).
- `COPY` blocks for row data.
- `CREATE INDEX`, `ALTER TABLE ADD CONSTRAINT`, sequence resets.

It does **not** contain:
- The Supabase-specific `_prisma_migrations` table unless `--table` is
  omitted (default dumps all tables in `public`).
- Roles, subscriptions, or extensions installed at the Supabase account
  level (those live in Supabase's own backup).

---

## 2. Recovery procedure

### 2.1 — Full restore from `pg_dump` file

```bash
# Step 1: drop everything in the public schema (DESTRUCTIVE — confirm twice).
psql "$DATABASE_URL" <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
SQL

# Step 2: restore the dump.
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backup-YYYYMMDD-HHMMSS.sql

# Step 3: verify table count.
psql "$DATABASE_URL" -t -A -c "
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name != '_prisma_migrations';
"
# Expect 14.
```

### 2.2 — Partial restore (single dropped row / table)

If only one table or row was damaged:

```bash
# Extract just the table's data from the dump.
pg_restore --table="Order" --data-only \
  --dbname="$DATABASE_URL" backup-YYYYMMDD.dump
```

For plain-text dumps, manually extract the relevant `COPY` block from the
file with a text editor and pipe it through `psql`.

### 2.3 — Recovery via Supabase PITR (Pro plan and above)

Supabase Pro offers point-in-time recovery (PITR) up to the last commit.
Trigger from **Dashboard → Database → Backups → Restore**.

- PITR is faster than `pg_dump` restore for large DBs.
- It restores the **entire** database to a chosen timestamp — you cannot
  selectively restore one table.
- The recovery runs in-place; the old state is overwritten. Take a fresh
  `pg_dump` first if you might need to return to the pre-restore state.

---

## 3. Rollback limitations

### 3.1 — Additive migrations (safe to undo)

These can be rolled back by `DROP`:

| Object | How to undo |
| --- | --- |
| New table (`Customer`, `DeviceSyncState`, `PrintDeliveryAttempt`, `FileCleanupTask`) | `DROP TABLE "<name>";` |
| New column (`Shop.paymentMethods`, `Shop.pamphletEnabled`, etc.) | `ALTER TABLE "Shop" DROP COLUMN "paymentMethods";` (data in that column is lost) |
| New index | `DROP INDEX "<index_name>";` |
| New partial unique (`PrintJob_active_file_unique`, `Order_shop_tokenNumber_unique`) | `DROP INDEX "<name>";` |

### 3.2 — Destructive migrations (NOT reversible without backup)

| Operation | Why it's destructive |
| --- | --- |
| `ALTER TABLE ... ALTER COLUMN ... TYPE` | Coerces existing data; original types/values lost |
| `DROP COLUMN` | Column data is destroyed (PostgreSQL does not retain it) |
| `DROP TABLE` | Rows lost unless dumped first |
| `prisma migrate reset` | Drops every table — see Runbook § 4.3 |
| `db push --accept-data-loss` | Drops whatever Prisma doesn't recognize |

For destructive operations, the **only** rollback path is restoring from
the pre-migration `pg_dump` (§ 2.1). Document this in the migration's
PR description.

### 3.3 — Migration history rollback (Prisma)

```bash
# Mark a migration as rolled-back in _prisma_migrations (does NOT undo SQL).
bunx prisma migrate resolve --rolled-back <migration_name>
```

This only updates `_prisma_migrations`. You must manually run the
compensating SQL (the reverse of the migration) yourself, then either
re-resolve or commit a new forward migration.

---

## 4. Emergency contacts and dashboards

| Resource | URL / channel |
| --- | --- |
| Supabase project dashboard | `https://supabase.com/dashboard/project/<project-ref>` |
| Supabase DB backups (PITR) | Dashboard → Database → Backups |
| Supabase status page | `https://status.supabase.com/` |
| Supabase support | Dashboard → Help → New support ticket (Pro plan) |
| Vercel project dashboard | `https://vercel.com/<org>/<project>` |
| Vercel deployment logs | Dashboard → Deployments → latest → Logs |
| Vercel env vars (DATABASE_URL) | Dashboard → Settings → Environment Variables |
| PrintShop on-call | See `docs/OPERATIONS_RUNBOOK.md` § "Escalation" |
| Slack channel | `#printshop-incidents` (if configured) |

### 4.1 — When to call Supabase support

- DB unresponsive for > 5 minutes (not a deploy window).
- PITR needed but dashboard shows "no backups available".
- Connection pool exhausted (`pgBouncer` errors).
- Storage quota hit (PDFs cannot upload).

Have ready: project ref, last known-good timestamp, error message, recent
deploy URLs from Vercel.

---

## 5. Prevention checklist

Run this checklist before **every** production schema change:

- [ ] `pg_dump` backup taken and uploaded off-host (§ 1.1).
- [ ] `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` reviewed.
- [ ] No `DATETIME` types in any pending migration SQL (must be `TIMESTAMP(3)`).
- [ ] No `db push`, `db push --accept-data-loss`, or `migrate reset` in the runbook.
- [ ] `prisma/pg-constraints.sql` reviewed if any partial-unique semantics changed.
- [ ] Vercel env var `DATABASE_URL` points to the **direct** (port 5432) URL for migration, not the pooler (port 6543) — Prisma migrations can fail with `pgBouncer` transaction-mode limitations.
- [ ] Maintenance window communicated (migrations block writes on affected tables).
- [ ] Rollback SQL prepared (or backup restore procedure confirmed ready).
- [ ] `prisma migrate status` post-deploy returns "up to date".
- [ ] Smoke test: `curl https://<domain>/api/v1/health` returns 200.
- [ ] Smoke test: a known shop's orders list loads.

### 5.1 — Daily prevention (automated)

- Vercel deploy hook calls `/api/v1/db-health` post-deploy; alert if non-200.
- Supabase dashboard shows DB size < 80% of plan limit.
- `_prisma_migrations` row count equals committed migration count
  (`scripts/postgres-verify.mjs` checks this in CI).

---

## 6. Quick recovery decision tree

```
Symptom → Action
────────────────────────────────────────────────────────────────────
Migration applied wrong column type        → § 2.1 full restore
Accidental DROP TABLE                      → § 2.1 full restore
                                          (or § 2.3 Supabase PITR)
Migration applied but data intact, schema wrong
                                          → § 3.1 additive undo
                                            (DROP COLUMN / DROP INDEX)
                                            then re-apply corrected migration
_prisma_migrations in inconsistent state   → § 3.3 prisma migrate resolve
                                          (DO NOT reset)
Webhook double-inserted PrintJobs          → manual SQL cleanup
                                          (PrintJob_active_file_unique
                                           was dropped — re-apply
                                           prisma/pg-constraints.sql)
DB unresponsive                            → § 4 call Supabase support
```

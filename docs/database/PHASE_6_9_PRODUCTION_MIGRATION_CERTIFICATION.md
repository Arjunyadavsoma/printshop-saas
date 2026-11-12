# Phase 6.9 — Production Migration Script Certification

**Date:** 2026-11-10
**Audited script:** `scripts/pg-migrate-prod.sh`
**Schema baseline:** `prisma/schema.prisma` (provider=postgresql)
**Test target:** Disposable PostgreSQL 17.11 staging database `printshop_staging_69` at `127.0.0.1:5433`

---

## 1. What the script does (step by step)

`scripts/pg-migrate-prod.sh` is the **production-safe** schema deploy tool.
It exists because `prisma migrate deploy` against a `postgresql://` URL fails
with `ERROR: type "datetime" does not exist` — the committed baseline
migration `20261015172034_init/migration.sql` is SQLite-specific (uses
`DATETIME`, SQLite boolean syntax). `pg-migrate-prod.sh` bypasses that trap.

The script's flow (`set -euo pipefail`, `cd` to repo root):

| Step | Action | Purpose |
|------|--------|---------|
| **1** | Validate `DATABASE_URL` is set; reject SQLite (`file:`) URLs; require `psql` + `bunx` on `PATH`. | Fail-fast before any DB contact. |
| **2** | Make a temp copy of `prisma/schema.prisma`; `sed` it to `provider = "postgresql"`. Run `bunx prisma migrate diff --from-empty --to-schema-datamodel <tmp> --script > $DDL_FILE`. | Generate postgresql-native DDL for the FULL schema.prisma (NOT the committed SQLite migration). |
| **3** | Print the first 5 lines of the generated DDL to stderr (preview). | Operator can eyeball before apply. |
| **4** | Apply the DDL via `psql -v ON_ERROR_STOP=1 -q -f "$DDL_FILE"`. | Create tables + indexes (CREATE TABLE / CREATE INDEX — non-idempotent). |
| **4b** | Apply `prisma/pg-constraints.sql` via `psql`. | Add the partial unique indexes Prisma can't express in `schema.prisma`: `PrintJob_active_file_unique`, `Order_shop_tokenNumber_unique`, `PaymentAttempt_active_order_unique`. All are `DROP IF EXISTS` + `CREATE [UNIQUE] INDEX` (idempotent). |
| **5** | Insert a baseline row into `_prisma_migrations`: `(migration_name='20261015172034_init', finished_at=NOW())` `ON CONFLICT DO NOTHING`. | Mark the schema as already at baseline so future `prisma migrate deploy` calls don't try to re-apply the SQLite migration. |
| **6** | Verification query: counts tables (expects 8), indexes (expects 22), FKs (expects 9), applied migrations (≥1), and the partial unique index `PrintJob_active_file_unique` (expects 1). | Sanity-check post-apply state. Exits 1 if counts don't match expectations (NOTE: expectations are stale — see §7). |

The script uses `trap 'rm -f "$TMP_SCHEMA" "$DDL_FILE"' EXIT` to clean up
temp files.

---

## 2. How it differs from `prisma migrate deploy`

| Aspect | `prisma migrate deploy` | `scripts/pg-migrate-prod.sh` |
|--------|--------------------------|--------------------------------|
| **Source of DDL** | Committed migration SQL files in `prisma/migrations/*/migration.sql`. | Generated at runtime from `schema.prisma` via `prisma migrate diff`. |
| **Provider compatibility** | Applies SQLite-specific SQL (DATETIME, no `BOOLEAN` etc.) verbatim to PostgreSQL → fails on the init migration. | Generates postgresql-native DDL (TIMESTAMP, BOOLEAN, etc.). |
| **Idempotency** | Tracks applied migrations in `_prisma_migrations` — never re-applies. | The DDL step is NOT idempotent (`CREATE TABLE` without `IF NOT EXISTS`) — re-running on an already-migrated DB fails with `relation "Shop" already exists`. Only steps 4b (constraints) and 5 (baseline record) are idempotent. |
| **Partial unique indexes** | Applied by the migration `20251110000000_add_active_attempt_unique_index` (for `PaymentAttempt_active_order_unique`). The other two (`PrintJob_active_file_unique`, `Order_shop_tokenNumber_unique`) are NOT in any migration — only in `pg-constraints.sql`. | Applies ALL three partial unique indexes via `pg-constraints.sql` (DROP IF EXISTS + CREATE — idempotent). |
| **FK constraints** | Applied by migration `20261015172035_add_payment_fk_constraints` (idempotent DO blocks). | Applied via `prisma migrate diff` output (FKs are part of `CREATE TABLE`). |
| **Baseline tracking** | Each migration recorded in `_prisma_migrations` as applied. | Only the SINGLE baseline `20261015172034_init` is recorded — the 3 later migrations (`20251108000000_add_delivery_and_sync`, `20251110000000_add_active_attempt_unique_index`, `20261015172035_add_payment_fk_constraints`) are NOT recorded. This is correct because `prisma migrate diff --from-empty` generates the FULL current schema in one shot (all later migrations are folded into the baseline). |
| **Failure mode** | Fails fast on the first migration that errors. | Fails fast (`set -e` + `ON_ERROR_STOP=1`) but the non-idempotent DDL step leaves the DB in a partial state if it fails mid-way. |

---

## 3. Does it preserve the partial unique index?

**YES — all three partial unique indexes are applied** via `prisma/pg-constraints.sql`:

1. `PrintJob_active_file_unique ON "PrintJob"("fileId") WHERE status IN ('queued', 'printing')` — print-job idempotency guard.
2. `Order_shop_tokenNumber_unique ON "Order"("shopId", "tokenNumber") WHERE "tokenNumber" IS NOT NULL` — per-shop token uniqueness (race-safe allocation).
3. `PaymentAttempt_active_order_unique ON "PaymentAttempt"("orderId") WHERE "status" = 'created'"` — checkout idempotency guard (at most one 'created' attempt per order).

All three use `DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX` (or `CREATE UNIQUE INDEX IF NOT EXISTS` for the PaymentAttempt one) — fully idempotent.

**Verified on the staging DB** (see §6 below):
```
printshop_staging_69=# SELECT indexname FROM pg_indexes WHERE indexname = 'PaymentAttempt_active_order_unique';
 PaymentAttempt_active_order_unique
```

---

## 4. Does it preserve FK constraints?

**YES — all 12 FK constraints are applied.** They come from two sources:

- `prisma migrate diff` output: FKs declared inline in `CREATE TABLE` (e.g. `Order.shopId REFERENCES Shop(id)`, `PrintFile.orderId REFERENCES Order(id)`, etc.) — 9 FKs.
- The Phase 6.7 migration `20261015172035_add_payment_fk_constraints` adds 3 FKs for the payment tables (`PaymentAttempt_shopId_fkey`, `PaymentAttempt_orderId_fkey`, `PaymentEvent_attemptId_fkey`). These are NOT in `prisma migrate diff` output (they're in a separate migration file). The script DOES NOT apply this migration — but the FKs ARE present in the staging DB because `prisma migrate diff --to-schema-datamodel` reads the schema.prisma which has `shop Shop @relation(...)` / `order Order @relation(...)` / `attempt PaymentAttempt @relation(...)` directives — these generate the FK constraints in the DDL output.

**Verified on the staging DB:**
```
printshop_staging_69=# SELECT conname FROM pg_constraint WHERE contype='f' ORDER BY conname;
 AuditLog_shopId_fkey
 AuditLog_userId_fkey
 Order_shopId_fkey
 PaymentAttempt_orderId_fkey     ← Phase 6.7 P0 fix
 PaymentAttempt_shopId_fkey      ← Phase 6.7 P0 fix
 PaymentEvent_attemptId_fkey     ← Phase 6.6 P0 fix (AUDIT-007)
 PrintAgent_shopId_fkey
 PrintFile_orderId_fkey
 PrintJob_fileId_fkey
 PrintJob_shopId_fkey
 Subscription_shopId_fkey
 User_shopId_fkey
(12 rows)
```

All 3 payment FK constraints (the ones added by the Phase 6.6 + 6.7 P0 fixes)
are present in the staging DB after `pg-migrate-prod.sh` runs.

---

## 5. Is it safe for already-migrated databases?

**NO — the DDL step is NOT idempotent.** Re-running `pg-migrate-prod.sh` on a
database where the tables already exist fails immediately:

```
→ Applying DDL to postgresql://z@127.0.0.1:5433/printshop_app_test ...
psql:/tmp/printshop-migration.RwgRl3.sql:2: NOTICE:  schema "public" already exists, skipping
psql:/tmp/printshop-migration.RwgRl3.sql:36: ERROR:  relation "Shop" already exists
```

The generated DDL uses `CREATE TABLE` (NOT `CREATE TABLE IF NOT EXISTS`)
because `prisma migrate diff --from-empty --to-schema-datamodel` assumes a
clean target.

**Operational guidance:**
- Run `pg-migrate-prod.sh` ONCE on a fresh database.
- For incremental schema changes after the baseline, use `prisma migrate dev`
  (creates a new migration) + `prisma migrate deploy` (applies it).
- The `pg-constraints.sql` step IS idempotent (DROP IF EXISTS + CREATE) —
  re-running JUST that file is safe (e.g. `psql -f prisma/pg-constraints.sql`).
- The `_prisma_migrations` baseline insert IS idempotent (`ON CONFLICT DO NOTHING`).

**Recommendation:** add a guard at the top of the script that checks
`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`
and aborts if >0 tables already exist (or add a `--force` flag to override).

---

## 6. Staging database test results

Tested against a disposable PostgreSQL 17.11 staging database
`printshop_staging_69` (created fresh via `CREATE DATABASE`).

### Run 1 — Fresh database (first invocation)

```bash
$ export DATABASE_URL="postgresql://z@127.0.0.1:5433/printshop_staging_69"
$ bash scripts/pg-migrate-prod.sh

→ Generating postgresql-native DDL from prisma/schema.prisma ...
  Generated DDL: 401 lines, 14 tables, 8 indexes.
→ Applying DDL to postgresql://z@127.0.0.1:5433/printshop_staging_69 ...
  DDL applied.
→ Applying PostgreSQL-specific constraints (partial unique indexes) ...
  Constraints applied.
→ Recording baseline migration in _prisma_migrations ...
  Baseline recorded.

→ Verification:
  Tables:            14 (expected 8)
  Indexes:           49 (expected 22 — 21 from DDL + 1 partial unique)
  Foreign keys:      12 (expected 9)
  Applied migrations: 1 (expected 1)
  Partial unique idx: 1 (expected 1 — PrintJob_active_file_unique)

⚠️  Migration applied but verification shows unexpected counts.
```

**Outcome:** Schema applied successfully. All 14 tables, 49 indexes, 12 FKs,
3 partial unique indexes (`PrintJob_active_file_unique`,
`Order_shop_tokenNumber_unique`, `PaymentAttempt_active_order_unique`) are
present. The `_prisma_migrations` baseline row is recorded.

The "⚠️ Migration applied but verification shows unexpected counts" warning
is a FALSE POSITIVE — the script's hardcoded expectations (8 tables, 22
indexes, 9 FKs) are stale. They reflect the schema at the time the script
was written, before Phase 5-7 added the delivery/sync/Customer/payment
tables. The actual counts (14/49/12) are correct for the current schema.

### Run 2 — Already-migrated database (re-invocation for idempotency)

```bash
$ bash scripts/pg-migrate-prod.sh
→ Generating postgresql-native DDL ...
→ Applying DDL to postgresql://z@127.0.0.1:5433/printshop_staging_69 ...
psql:/tmp/printshop-migration.H6xJz0.sql:36: ERROR:  relation "Shop" already exists
```

**Outcome:** Fails as expected (the DDL step is non-idempotent). No data
loss, no partial state — the script aborts on the first duplicate CREATE.
The previously-applied schema is untouched.

### Run 3 — Against the Phase 6.9 test DB (`printshop_app_test`)

```bash
$ export DATABASE_URL="postgresql://z@127.0.0.1:5433/printshop_app_test"
$ bash scripts/pg-migrate-prod.sh
psql:/tmp/printshop-migration.RwgRl3.sql:36: ERROR:  relation "Shop" already exists
```

**Outcome:** Same failure — confirms the script correctly refuses to
re-apply DDL on an already-migrated DB. (The Phase 6.9 test DB was
initialized via `prisma migrate deploy` + `db:push` for drift remediation,
so the tables already exist.)

### Post-apply structural verification

```sql
printshop_staging_69=# \dt
 AuditLog, Customer, DeviceSyncState, FileCleanupTask, Order,
 PaymentAttempt, PaymentEvent, PrintAgent, PrintDeliveryAttempt,
 PrintFile, PrintJob, Shop, Subscription, User
(14 tables + _prisma_migrations)

printshop_staging_69=# SELECT indexname FROM pg_indexes
  WHERE indexname IN ('PaymentAttempt_active_order_unique',
                      'PrintJob_active_file_unique',
                      'Order_shop_tokenNumber_unique');
 PaymentAttempt_active_order_unique
 PrintJob_active_file_unique
 Order_shop_tokenNumber_unique
(3 partial unique indexes — all present)

printshop_staging_69=# SELECT conname FROM pg_constraint WHERE contype='f';
 (12 FK constraints — all present, including the 3 Phase 6.6/6.7 payment FKs)

printshop_staging_69=# SELECT migration_name, finished_at IS NOT NULL
  FROM _prisma_migrations;
 20261015172034_init | t
(1 baseline row — correct)
```

---

## 7. Does it have a dry-run mode?

**NO.** There is no `--dry-run` flag, no `PG_MIGRATE_DRY_RUN` env var, and
no preview-only mode. The script's only "preview" is printing the first 5
lines of the generated DDL to stderr (step 3) before applying it.

**Recommendation:** add a `--dry-run` flag that prints the full DDL + the
constraints SQL + the baseline INSERT to stdout WITHOUT executing them
against the database. This is the standard pattern for production migration
scripts (e.g. `prisma migrate diff --script` already supports this — the
script just needs to skip the `psql` calls).

---

## 8. Risks and recommendations

### Risks

1. **Non-idempotent DDL step (RISK: HIGH).** Re-running the script on an
   already-migrated database fails with `relation "Shop" already exists`.
   This is recoverable (no data loss) but blocks incremental re-deploys.
   Production runbooks that "just re-run the script" will fail.

2. **Stale verification expectations (RISK: LOW).** The hardcoded table
   count (8), index count (22), FK count (9) are from an earlier schema
   version. The script exits 1 ("⚠️ Migration applied but verification
   shows unexpected counts") even when the schema is correctly applied.
   This causes false alarms in CI/CD pipelines.

3. **No dry-run mode (RISK: MEDIUM).** Operators cannot preview the full
   DDL before applying. The 5-line preview is insufficient for reviewing
   a 401-line DDL file.

4. **Partial unique indexes applied in a SEPARATE step (RISK: LOW).** If
   `pg-constraints.sql` is missing (the script checks + exits 1 if so),
   the partial unique indexes are NOT applied — the schema is half-migrated.
   The exit-1 guard mitigates this, but a transactional apply (DDL +
   constraints in a single BEGIN/COMMIT) would be safer.

5. **Baseline records only ONE migration (RISK: LOW).** The
   `_prisma_migrations` row says `20261015172034_init` was applied — but
   the actual schema includes changes from 3 later migrations (delivery/
   sync, payment tables, payment FKs). If a future `prisma migrate deploy`
   is run, Prisma will see `20261015172034_init` as applied but will try
   to apply the 3 later migrations. Two of them
   (`20251110000000_add_active_attempt_unique_index`,
   `20261015172035_add_payment_fk_constraints`) ARE idempotent (IF NOT
   EXISTS / DO blocks) — they'll no-op. The third
   (`20251108000000_add_delivery_and_sync`) uses `CREATE TABLE` without
   `IF NOT EXISTS` — it will FAIL with "relation already exists".

### Recommendations

1. **Add idempotency guards (P0).** Either:
   - Use `CREATE TABLE IF NOT EXISTS` in the DDL (requires patching the
     `prisma migrate diff` output), OR
   - Add a pre-check at the top of the script: if
     `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`
     > 0, skip the DDL step + jump to the constraints + baseline steps.

2. **Update the verification expectations (P1).** Replace the hardcoded
   counts with dynamic queries: count the tables actually expected from
   `schema.prisma` (14), count the indexes (49), count the FKs (12). Or
   remove the count checks entirely + verify by name (the partial unique
   index check by name is already correct).

3. **Add a `--dry-run` flag (P1).** Print the full DDL + constraints SQL
   + baseline INSERT to stdout without executing. Standard for production
   migration scripts.

4. **Wrap DDL + constraints in a single transaction (P2).** Currently
   the DDL is applied with one `psql -f` call + the constraints with a
   second `psql -f` call. If the second fails (e.g. a duplicate
   tokenNumber is found), the DDL is already committed — partial state.
   Wrapping both in `BEGIN; ... COMMIT;` (via a single SQL file or a
   `psql -1` flag) would make the apply atomic.

5. **Record ALL four migrations in `_prisma_migrations` (P2).** Currently
   only `20261015172034_init` is recorded. Recording the other three
   (with `finished_at=NOW()`) would let future `prisma migrate deploy`
   calls skip them — preventing the "relation already exists" failure
   described in risk #5.

6. **Document the script's purpose vs `prisma migrate deploy` (P2).**
   The script's header comment is excellent, but a one-paragraph summary
   in the operations runbook would help on-call engineers pick the right
   tool.

---

## 9. Verdict

**The script is SAFE for first-time deploys to a fresh PostgreSQL database
and correctly applies the full schema.prisma + all partial unique indexes
+ all FK constraints (including the Phase 6.6/6.7 P0 payment FKs).**

**It is NOT safe for re-runs on already-migrated databases** (the DDL step
is non-idempotent — fails with "relation already exists").

**The verification step's expectations are stale** (hardcoded 8/22/9 vs
actual 14/49/12) — the script prints a false-positive warning even when
the schema is correctly applied. This does NOT block the deploy (the
schema is applied before the verification step runs), but it causes
false alarms.

**Recommendation for Phase 6.9 production deploy:** use the script ONCE
to bootstrap a fresh production database, then use `prisma migrate deploy`
for incremental changes. Add the idempotency guard (rec #1) + update the
verification expectations (rec #2) before the next phase.

**Test target disposal:** the `printshop_staging_69` database can be
dropped via `DROP DATABASE printshop_staging_69;` — it's disposable, no
production data.

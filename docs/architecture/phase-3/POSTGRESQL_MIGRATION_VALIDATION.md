# PostgreSQL Migration Validation

> Validation checklist for the migration baseline procedure.

**Status:** DOCUMENTED — not executed

---

## Validation checks

| # | Check | Method | Expected result |
|---|---|---|---|
| 1 | Production DB is PostgreSQL | `curl /api/v1/db-health` | `databaseUrl` starts with `postgresql://` |
| 2 | 14 tables exist | `db-health` → `tables` array | All 14 model names present |
| 3 | `PrintJob_active_file_unique` exists | `SELECT indexname FROM pg_indexes WHERE indexname = 'PrintJob_active_file_unique'` | Returns 1 row |
| 4 | `migration_lock.toml` is postgresql | `cat prisma/migrations/migration_lock.toml` | `provider = "postgresql"` |
| 5 | Schema matches Prisma | `prisma migrate diff --from-url ... --to-schema-datamodel ...` | Empty output (no diff) |
| 6 | `_prisma_migrations` table created | `SELECT count(*) FROM "_prisma_migrations"` | Returns 2 (after resolve) |
| 7 | Existing data preserved | `SELECT count(*) FROM "Shop"` | 1 (unchanged) |
| 8 | Existing data preserved | `SELECT count(*) FROM "User"` | 1 (unchanged) |

## Test environment

The baseline procedure should be tested against an isolated PostgreSQL instance first:
1. Create a Supabase staging project (or use `docker run -e POSTGRES_PASSWORD=test postgres:16`)
2. Run `bun run db:push` to create the schema from Prisma
3. Run the setup-database endpoint to add the partial unique index
4. Run the baseline procedure (Steps 1-5 above)
5. Verify all 8 checks pass
6. If all pass → proceed with production

## Limitations

- The init migration (`20261015172034_init`) contains SQLite SQL — it will NOT be executed by `prisma migrate resolve --applied` (resolve only marks it as applied, doesn't run the SQL)
- Future migrations must be PostgreSQL-compatible
- If the schema diff (Step 2) shows missing tables/columns, they must be created manually BEFORE resolving

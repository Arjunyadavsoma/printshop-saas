# Production Database Recovery

> How to recover the production database if a migration or schema change fails.

---

## 1. Backup procedure (BEFORE any migration)

```bash
# Full backup
pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d-%H%M%S).sql

# Verify backup is non-empty
ls -la backup-*.sql
# Should be > 1KB

# Store in a secure location (NOT in the git repo)
```

## 2. Recovery procedure

### If a migration fails mid-execution:

```bash
# 1. Check what state the DB is in
psql "$DATABASE_URL" -c "SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"

# 2. If a migration is stuck (rolled_back_at is NULL, finished_at is NULL):
bunx prisma migrate resolve --rolled-back <migration_name>

# 3. Restore from backup if data was affected:
psql "$DATABASE_URL" < backup-YYYYMMDD-HHMMSS.sql
```

### If the setup-database endpoint fails:

```bash
# The endpoint uses CREATE TABLE IF NOT EXISTS (idempotent)
# Re-run it:
curl -X POST "https://printshop-saas-three.vercel.app/api/v1/setup-database?key=YOUR_KEY"
```

### If a table was accidentally dropped:

```bash
# Restore from backup
psql "$DATABASE_URL" < backup-YYYYMMDD-HHMMSS.sql

# Or recreate just the missing table:
# Paste the CREATE TABLE SQL from prisma/migrations/ into Supabase SQL Editor
```

## 3. Rollback limitations

| Scenario | Can rollback? | Limitation |
|---|---|---|
| Additive migration (new table/column) | ✅ Yes | DROP the new table/column |
| Destructive migration (dropped column) | ⚠️ Only via backup | Lost data can't be recovered without backup |
| Data migration (UPDATE/DELETE) | ⚠️ Only via backup | No transaction-level rollback after commit |
| Schema drift fix | ✅ Yes | Re-run the correct SQL |

## 4. Emergency contacts

- Supabase Dashboard: https://supabase.com/dashboard/project/duyharicyurufmsjyhgs
- Vercel Dashboard: https://vercel.com/printshop-saas
- GitHub: https://github.com/Arjunyadvsoma/printshop-saas

## 5. Prevention

- ALWAYS backup before any schema change
- Test migrations on staging first
- Use additive migrations (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS)
- NEVER use `prisma migrate reset` on production
- NEVER use `prisma db push --accept-data-loss` on production

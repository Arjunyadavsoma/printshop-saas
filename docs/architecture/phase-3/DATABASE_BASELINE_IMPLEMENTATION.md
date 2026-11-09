# Database Baseline Implementation

> Safe procedure for baselining the Prisma migration history against
> the existing production PostgreSQL database.

**Status:** DOCUMENTED — not executed (requires user approval)

---

## 1. Current state

- **Production DB:** PostgreSQL (Supabase pooler, port 6543)
- **Tables:** 14 (created via `/api/v1/setup-database` endpoint, NOT via `prisma migrate`)
- **`_prisma_migrations` table:** DOES NOT EXIST
- **Init migration:** SQLite SQL (incompatible with PostgreSQL)
- **`migration_lock.toml`:** `provider = "postgresql"` (correct)

## 2. Safe baseline procedure

### Step 1: Backup
```bash
pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d).sql
```

### Step 2: Compare schema
```bash
bunx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```
If the output is empty → schema matches, proceed to Step 3.
If the output has SQL → fix the diff first (run the SQL via Supabase SQL Editor), then proceed.

### Step 3: Create _prisma_migrations table
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

### Step 4: Mark migrations as applied
```bash
bunx prisma migrate resolve --applied 20261015172034_init
bunx prisma migrate resolve --applied 20251108000000_add_delivery_and_sync
```

### Step 5: Verify
```bash
bunx prisma migrate status
# Should show all migrations as applied
```

## 3. Rollback

```bash
psql "$DATABASE_URL" < backup-YYYYMMDD.sql
```

## 4. Future migrations

After baselining, future schema changes should use:
```bash
bunx prisma migrate dev --name <description>
# This creates a new migration file + applies it
```

**Never use `prisma db push` after baselining** — it bypasses the migration history.

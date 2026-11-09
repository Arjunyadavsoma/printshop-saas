# Schema Drift Report

Comparison of `prisma/schema.prisma` against the production database schema
(created by `src/app/api/v1/setup-database/route.ts` `SETUP_SQL`) and the
PostgreSQL-specific constraints in `prisma/pg-constraints.sql`.

> Status:KNOWN DRIFT — must be reconciled before running
> `prisma migrate resolve`. See `DATABASE_BASELINE.md` § 2 Step 2.
> Last reviewed against commit at HEAD of `main`.

---

## 1. Source files compared

| Source | Purpose |
| --- | --- |
| `prisma/schema.prisma` | Canonical Prisma schema — 14 models, PostgreSQL provider |
| `src/app/api/v1/setup-database/route.ts` | `SETUP_SQL` constant + inline partial-unique creation |
| `prisma/pg-constraints.sql` | Partial unique indexes Prisma can't express |
| `prisma/migrations/20261015172034_init/migration.sql` | Committed init migration (SQLite dialect) |
| `prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql` | Additive PG migration for 4 tables |

---

## 2. Models in schema but NOT in setup SQL

| # | Prisma model | In setup SQL? |
| --- | --- | --- |
| 1 | `Shop` | ✅ line 55 |
| 2 | `User` | ✅ line 72 |
| 3 | `Order` | ✅ line 79 |
| 4 | `PrintFile` | ✅ line 91 |
| 5 | `PrintJob` | ✅ line 101 |
| 6 | `PrintAgent` | ✅ line 110 (+ ALTER for `tokenHash`) |
| 7 | `Subscription` | ⚠️ line 117 — **column drift**, see § 3 |
| 8 | `AuditLog` | ✅ line 123 |
| 9 | `PaymentAttempt` | ✅ line 130 |
| 10 | `PaymentEvent` | ✅ line 142 |
| 11 | `DeviceSyncState` | ✅ line 173 |
| 12 | `Customer` | ✅ line 183 |
| 13 | `PrintDeliveryAttempt` | ✅ line 193 |
| 14 | `FileCleanupTask` | ✅ line 207 |

**Result: ZERO missing models.** All 14 Prisma models have a corresponding
`CREATE TABLE` in the setup SQL. Drift exists only at the column / index
level (§ 3 and § 4).

> Note: `PaymentAttempt` and `PaymentEvent` are in setup SQL but NOT in
> any committed `prisma/migrations/` folder. After the baseline is
> recorded, a future `prisma migrate dev` touching them will generate a
> fresh migration folder — this is expected.

---

## 3. Columns in schema but NOT in setup SQL

### 3.1 — `Subscription` table (CRITICAL DRIFT)

The `Subscription` table created by setup SQL uses a **different column
set** than `schema.prisma`. Any Prisma query against `Subscription` will
fail at runtime with `column "currentPeriodStart" does not exist`.

| Column | Prisma schema | Setup SQL | Status |
| --- | --- | --- | --- |
| `id` | `TEXT` | `TEXT` | ✅ match |
| `shopId` | `TEXT` (with `@unique`) | `TEXT` (no unique index) | ⚠️ missing unique — see § 4.3 |
| `tier` | `TEXT` default `'free'` | `TEXT` default `'free'` | ✅ |
| `status` | `TEXT` default `'active'` | `TEXT` default `'active'` | ✅ |
| `currentPeriodStart` | `DateTime` (required) | **—** | ❌ MISSING in setup SQL |
| `currentPeriodEnd` | `DateTime` (required) | **—** | ❌ MISSING in setup SQL |
| `provider` | `TEXT` default `'internal'` | **—** | ❌ MISSING in setup SQL |
| `providerSubscriptionId` | `String?` | **—** | ❌ MISSING in setup SQL |
| `startedAt` | **—** | `TIMESTAMP(3)` default `CURRENT_TIMESTAMP` | ⚠️ EXTRA in setup SQL (not in Prisma) |
| `expiresAt` | **—** | `TIMESTAMP(3)` nullable | ⚠️ EXTRA in setup SQL (not in Prisma) |
| `createdAt` | `DateTime` default `now()` | `TIMESTAMP(3)` default `CURRENT_TIMESTAMP` | ✅ |
| `updatedAt` | `DateTime` `@updatedAt` | `TIMESTAMP(3)` | ✅ |

**Remediation SQL** (apply via Supabase SQL Editor before
`migrate resolve`):

```sql
-- Add missing Prisma columns.
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "provider"           TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "providerSubscriptionId" TEXT;

-- Backfill currentPeriodStart / currentPeriodEnd from the legacy columns
-- before they become NOT NULL strictly enforced.
UPDATE "Subscription"
SET "currentPeriodStart" = "startedAt"
WHERE "currentPeriodStart" IS NULL OR "currentPeriodStart" = CURRENT_TIMESTAMP;

UPDATE "Subscription"
SET "currentPeriodEnd" = COALESCE("expiresAt", "startedAt" + INTERVAL '30 days')
WHERE "currentPeriodEnd" IS NULL OR "currentPeriodEnd" = CURRENT_TIMESTAMP + INTERVAL '30 days';

-- Add the missing unique index for shopId (Prisma's @unique).
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_shopId_key" ON "Subscription"("shopId");

-- Drop the legacy columns ONLY after verifying app code no longer reads them.
-- (Search: `startedAt` and `expiresAt` in src/ — should return zero hits.)
-- ALTER TABLE "Subscription" DROP COLUMN "startedAt";
-- ALTER TABLE "Subscription" DROP COLUMN "expiresAt";
```

### 3.2 — All other 13 tables: column-perfect match

Each of the 13 tables below was verified column-by-column (name, type,
nullability, default) against `schema.prisma`. No drift detected.

| Table | Cols in Prisma | Cols in setup SQL | Notes |
| --- | --- | --- | --- |
| `Shop` | 28 | 28 | `pamphletEnabled` etc. added via `CREATE TABLE` + redundant `ALTER ADD COLUMN IF NOT EXISTS` (lines 165–168) |
| `User` | 8 | 8 | |
| `Order` | 15 | 15 | `tokenNumber` included |
| `PrintFile` | 17 | 17 | |
| `PrintJob` | 12 | 12 | |
| `PrintAgent` | 11 | 10 + 1 ALTER | `tokenHash` added via `ALTER TABLE` line 170 |
| `AuditLog` | 9 | 9 | |
| `PaymentAttempt` | 13 | 13 | |
| `PaymentEvent` | 12 | 12 | No `createdAt` in Prisma model (matches) |
| `DeviceSyncState` | 8 | 8 | |
| `Customer` | 11 | 11 | |
| `PrintDeliveryAttempt` | 15 | 15 | |
| `FileCleanupTask` | 13 | 13 | |

---

## 4. Indexes in `pg-constraints.sql` but NOT in Prisma schema

### 4.1 — `PrintJob_active_file_unique` (PARTIAL UNIQUE — Prisma cannot express)

**Definition** (`prisma/pg-constraints.sql` lines 32–34):

```sql
CREATE UNIQUE INDEX "PrintJob_active_file_unique"
  ON "PrintJob" ("fileId")
  WHERE status IN ('queued', 'printing');
```

**Also created by** `src/app/api/v1/setup-database/route.ts` line 39 (inline
`db.$executeRawUnsafe`, after the `SETUP_SQL` block).

**Prisma schema** for `PrintJob` (lines 124–142):
- `@@index([shopId, status])`, `@@index([agentId])` — non-unique
- **NO `@@unique` on `fileId`** — the partial unique exists ONLY in setup
  SQL inline + `pg-constraints.sql`, with **no `schema.prisma` representation**.

**Purpose:** prevents the check-then-insert (TOCTOU) race where two
concurrent webhook deliveries both insert an active PrintJob for the same
file. `WHERE status IN ('queued','printing')` allows reprints once a job
reaches `'completed'` / `'needs_review'`.

**Risk if dropped:** duplicate active PrintJobs → double-printing and
payment-layer idempotency-key violations.

### 4.2 — `Order_shop_tokenNumber_unique` (PARTIAL UNIQUE — mirrors Prisma's `@@unique`)

**Definition** (`prisma/pg-constraints.sql` lines 62–82):

```sql
CREATE UNIQUE INDEX "Order_shop_tokenNumber_unique"
  ON "Order" ("shopId", "tokenNumber")
  WHERE "tokenNumber" IS NOT NULL;
```

**Prisma schema** for `Order` (line 95):
```prisma
@@unique([shopId, tokenNumber])
```

Prisma's `@@unique([shopId, tokenNumber])` (line 95) generates a **full**
UNIQUE index `Order_shopId_tokenNumber_key` (no `WHERE` clause).
`pg-constraints.sql` adds a **second, partial** index `Order_shop_tokenNumber_unique`
that excludes NULL rows (smaller) and is idempotent (`DROP IF EXISTS` + `CREATE`),
with a pre-flight duplicate check (lines 63–79).

**Net effect:** after `pg-constraints.sql` runs, `Order` has **two**
unique indexes on `(shopId, tokenNumber)` — harmless (PG enforces both)
but consumes extra storage. Not a drift to remediate; just an artifact of
Prisma's lack of partial-unique support.

### 4.3 — `Subscription.shopId` unique — MISSING from setup SQL

**Prisma schema** (line 163): `shopId String @unique`

**Expected Prisma-generated index:** `Subscription_shopId_key` (UNIQUE on `shopId`)

**Setup SQL:** no `CREATE UNIQUE INDEX "Subscription_shopId_key"` statement.

Third drift on `Subscription` beyond § 3.1. Apply the
`CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_shopId_key"` from § 3.1.

> Pre-check: `SELECT shopId, COUNT(*) FROM "Subscription" GROUP BY shopId
> HAVING COUNT(*) > 1;` — if any rows return, resolve duplicates first.

---

## 5. `PrintJob_active_file_unique` — full lifecycle

| Source | Present? | Note |
| --- | --- | --- |
| `schema.prisma` | ❌ | Prisma can't express partial uniques |
| `20261015172034_init/migration.sql` | ❌ | SQLite-only, wouldn't apply |
| `20251108000000_add_delivery_and_sync/migration.sql` | ❌ | Additive tables only |
| `src/app/api/v1/setup-database/route.ts:39` | ✅ | Inline `CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE status IN ('queued','printing')` |
| `prisma/pg-constraints.sql:31-34` | ✅ | `DROP IF EXISTS` + `CREATE UNIQUE INDEX`; re-applied on every deploy via `scripts/pg-migrate-prod.sh:119` |

This index exists ONLY in setup SQL inline + `pg-constraints.sql`, is NOT
emitted by `prisma migrate diff --from-empty --to-schema-datamodel`, and
will be **missing** from any rebuild that skips `pg-constraints.sql`.
Always run `prisma/pg-constraints.sql` after any schema-apply operation.

---

## 6. Summary of remediation needed before baseline

| # | Drift | Remediation |
| --- | --- | --- |
| 1 | `Subscription.currentPeriodStart` missing | `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;` + backfill from `startedAt` |
| 2 | `Subscription.currentPeriodEnd` missing | `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days';` + backfill from `expiresAt` |
| 3 | `Subscription.provider` missing | `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'internal';` |
| 4 | `Subscription.providerSubscriptionId` missing | `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "providerSubscriptionId" TEXT;` |
| 5 | `Subscription.shopId` unique index missing | `CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_shopId_key" ON "Subscription"("shopId");` (after duplicate check) |
| 6 | `Subscription.startedAt` / `expiresAt` extra (not in Prisma) | Drop **only after** confirming `rg "startedAt\|expiresAt" src/` returns zero hits — kept for now to avoid breaking legacy reads |
| 7 | `PrintJob_active_file_unique` partial unique not in Prisma | No action — applied via setup SQL + `pg-constraints.sql`. Document in any new migration that touches `PrintJob`. |
| 8 | `Order_shop_tokenNumber_unique` partial unique duplicates Prisma's full unique | No action — harmless duplication. |

After items 1–5 are applied, re-run
`bunx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
— only item 6 (two extra columns) should remain; safe to leave until
legacy fields are confirmed unused.

---

## 7. Related docs

- `DATABASE_BASELINE.md` — 5-step procedure that consumes this report
- `POSTGRESQL_MIGRATION_RUNBOOK.md` — when to apply the remediation SQL
- `DATABASE_BACKUP_AND_RECOVERY.md` — backup before applying § 6 items
- `prisma/pg-constraints.sql` — partial-unique index source

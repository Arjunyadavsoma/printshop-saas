# DATABASE_AUDIT

Audit Date: 2025-11-09 · Branch: `main` · Commit: `dc24f4b`

Audit of the 14 Prisma models in `prisma/schema.prisma` and the migration
history in `prisma/migrations/`. Schema is read directly; the production
database was NOT queried from this sandbox (no `DATABASE_URL`).

Production target: **Supabase Postgres** (free tier), 14 tables, 1 shop,
1 user — verified via `GET /api/v1/db-health` (per audit context).

---

## 1. Models (14)

### 1.1 `Shop` (`prisma/schema.prisma:10`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `slug` | String | `@unique` |
| `ownerUserId` | String | (no FK — logical) |
| `upiId`, `paymentProvider`, `paymentCredentials`, `pricingConfig`, `address`, `phone` | String | required |
| `timezone` | String | default `Asia/Kolkata` |
| `isActive` | Boolean | default `true` |
| `subscriptionTier` | String | default `free` |
| `subscriptionExpiresAt` | DateTime? | nullable |
| `paymentMethods` | String | default `both` (`upi`/`cash`/`both`/`split`) |
| `pamphletEnabled`, `pamphletPricePaise`, `pamphletName` | Bool/Int/String? | pamphlet feature |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |

Tenant isolation: this **is** the tenant root — every other model has `shopId` FK back to `Shop.id`.
Indexes: `@@index([slug])` (the `@unique` already indexes slug; this is redundant).
Relations: `AuditLog[]`, `Order[]`, `PrintAgent[]`, `PrintJob[]`, `Subscription?`, `User[]`, `PaymentAttempt[]`.

> FIND-016 (P3): `Shop` has `@@index([slug])` in addition to
> `slug @unique`. The unique constraint already creates a B-tree index;
> the explicit `@@index` is redundant. Cosmetic — harmless.

### 1.2 `User` (`schema.prisma:60`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `email` | String | `@unique` |
| `phone` | String | required |
| `passwordHash` | String | `pbkdf2$<iter>$<saltB64>$<keyB64>` (see `JwtAuthAdapter`) |
| `role` | String | default `owner` (`owner`/`staff`/`admin`) |
| `shopId` | String? | FK → `Shop.id` (ON DELETE SET NULL) |
| `createdAt`, `updatedAt` | DateTime | defaults |

Tenant isolation: `shopId` (nullable — admin users have `shopId = null`).
Indexes: `@@index([shopId])`.

> FIND-017 (P2): `User` has **no soft-delete column** (`deletedAt`). A
> user cannot be deactivated without losing audit-log FK integrity
> (`AuditLog.userId` ON DELETE SET NULL would orphan the audit entry).
> This is a P2 — currently only 1 user exists in production.

### 1.3 `Order` (`schema.prisma:75`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String | FK → `Shop.id` |
| `customerToken` | String | required (the SEC-001 IDOR defense) |
| `status` | String | default `awaiting_payment` |
| `totalAmountPaise` | Int | required |
| `currency` | String | default `INR` |
| `paymentProvider` | String? | nullable |
| `paymentTxnId` | String? | `@unique` (idempotency guard) |
| `paymentUtr`, `paidAt`, `customerPhone`, `notes`, `tokenNumber` | various | nullable |
| `createdAt`, `updatedAt` | DateTime | defaults |

Tenant isolation: `shopId` (FK, ON DELETE RESTRICT).
Unique: `@@unique([shopId, tokenNumber])` — per-shop token uniqueness.
Indexes: `@@index([shopId, status])`, `@@index([customerToken])`.

### 1.4 `PrintFile` (`schema.prisma:100`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `orderId` | String | FK → `Order.id` (RESTRICT) |
| `originalFilename`, `storageKey`, `mimeType` | String | required |
| `sizeBytes`, `copies`, `pricePaise` | Int | required |
| `pageCount` | Int? | nullable (parsed from PDF on confirm) |
| `colorMode`, `paperSize`, `status` | String | defaults |
| `pageRange` | String? | nullable |
| `duplex` | Boolean | default `false` |
| `printedAt` | DateTime? | nullable |
| `createdAt`, `updatedAt` | DateTime | defaults |

Tenant isolation: **none directly** — relies on `order.shopId` via the
parent order. Queries must join through Order to enforce shop scope.
Indexes: `@@index([orderId])`.

> FIND-018 (P2): `PrintFile` has no `shopId` column. Tenant isolation
> is enforced by the `Order` parent only. The repository layer
> (`src/lib/repositories/file.repository.ts`) must always look up files
> via `findByIdAndOrderAndShop(orderId, shopId)` to prevent
> cross-shop access. If any new query path skips that, it leaks files
> across tenants.

### 1.5 `PrintJob` (`schema.prisma:124`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String | FK → `Shop.id` |
| `fileId` | String | FK → `PrintFile.id` |
| `agentId` | String? | FK (logical) → `PrintAgent.id` |
| `status` | String | default `queued` |
| `attempts` | Int | default `0` |
| `lastError` | String? | nullable |
| `queuedAt`, `startedAt`, `completedAt`, `createdAt`, `updatedAt` | DateTime | defaults |

Tenant isolation: `shopId`.
Indexes: `@@index([shopId, status])`, `@@index([agentId])`.

Plus a **partial unique index** created via raw SQL in `setup-database`:
`CREATE UNIQUE INDEX "PrintJob_active_file_unique" ON "PrintJob"("fileId") WHERE status IN ('queued', 'printing')`
(`src/app/api/v1/setup-database/route.ts:39`). This enforces at-most-one
active job per file — the ARCH-003 idempotency fix.

> FIND-019 (P1): The partial unique index `PrintJob_active_file_unique`
> is **NOT in any Prisma migration** — it's only created by the
> `setup-database` endpoint's raw SQL. If a fresh production database
> is provisioned via `prisma migrate deploy` (the documented Prisma
> workflow) instead of via `setup-database`, this index will be
> missing and the at-most-one-active-job guarantee will silently
> disappear, allowing duplicate print jobs on double-click.

### 1.6 `PrintAgent` (`schema.prisma:144`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String | FK → `Shop.id` |
| `name` | String | required |
| `tokenHash` | String | required (SHA-256 of device token) |
| `printerName`, `version`, `os` | String? | nullable |
| `isOnline` | Boolean | default `false` |
| `lastSeenAt` | DateTime? | nullable |
| `createdAt`, `updatedAt` | DateTime | defaults |

Tenant isolation: `shopId`.
Indexes: `@@index([shopId, isOnline])`.

### 1.7 `Subscription` (`schema.prisma:161`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String | `@unique` FK → `Shop.id` (one-to-one) |
| `tier`, `status` | String | defaults `free`/`active` |
| `currentPeriodStart`, `currentPeriodEnd` | DateTime | required |
| `provider` | String | default `internal` |
| `providerSubscriptionId` | String? | nullable |
| `createdAt`, `updatedAt` | DateTime | defaults |

Tenant isolation: `shopId` (unique — one subscription per shop).

### 1.8 `AuditLog` (`schema.prisma:175`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String? | FK → `Shop.id` (SET NULL) |
| `userId` | String? | FK → `User.id` (SET NULL) |
| `action`, `entityType`, `entityId`, `metadata` | String | required |
| `ip` | String? | nullable |
| `createdAt` | DateTime | `@default(now())` |

No `updatedAt` (audit logs are append-only).
Indexes: `@@index([shopId, createdAt])`.

Pruned: `src/lib/container.ts:378-385` deletes audit logs older than 30
days on startup (Neon free-tier DB-size defense).

### 1.9 `PaymentAttempt` (`schema.prisma:197`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String | FK → `Shop.id` |
| `orderId` | String | FK → `Order.id` |
| `provider` | String | required (`phonepe`/`paytm`/`googlepay`) |
| `merchantOrderId` | String | `@unique` (the PSP references this) |
| `providerTransactionId` | String? | nullable |
| `amountPaise` | Int | required |
| `currency` | String | default `INR` |
| `status` | String | default `created` (`created`/`pending`/`paid`/`failed`/`expired`) |
| `idempotencyKey` | String? | nullable |
| `expiresAt` | DateTime | required |
| `createdAt`, `updatedAt` | DateTime | defaults |

Tenant isolation: `shopId`.
Indexes: `@@index([shopId, status])`, `@@index([orderId])`, `@@index([providerTransactionId])`.

### 1.10 `PaymentEvent` (`schema.prisma:220`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `attemptId` | String | FK → `PaymentAttempt.id` (CASCADE) |
| `provider`, `eventType`, `processingStatus` | String | required |
| `eventId` | String? | nullable (PSP event id) |
| `merchantOrderId`, `providerTransactionId` | String? | nullable |
| `signatureValid` | Boolean | default `false` |
| `receivedAt` | DateTime | `@default(now())` |
| `processedAt`, `errorMessage` | various | nullable |

No `shopId` — derived via `attempt.shopId`. No `updatedAt`.
Unique: `@@unique([provider, eventId])` — webhook dedup.
Indexes: `@@index([attemptId])`, `@@index([merchantOrderId])`.

### 1.11 `DeviceSyncState` (`schema.prisma:244`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String | required (no FK declared — logical) |
| `deviceId` | String | required (PrintAgent.id) |
| `syncCursor` | String | default `1970-01-01T00:00:00Z` |
| `lastSyncAt`, `lastPushAt` | DateTime? | nullable |
| `createdAt`, `updatedAt` | DateTime | defaults |

Unique: `@@unique([shopId, deviceId])`.
Indexes: `@@index([shopId])`.

### 1.12 `Customer` (`schema.prisma:257`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `shopId` | String | required |
| `name` | String | required |
| `phone`, `email`, `address`, `notes` | String? | nullable |
| `revision` | Int | default `1` (sync version) |
| `deletedAt` | DateTime? | nullable (soft delete) |
| `createdAt`, `updatedAt` | DateTime | defaults |

Indexes: `@@index([shopId, updatedAt])`, `@@index([shopId, deletedAt])`.

### 1.13 `PrintDeliveryAttempt` (`schema.prisma:280`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `printJobId`, `agentId`, `shopId` | String | required (logical FKs) |
| `attemptId` | Int | default `1` (per-job sequence) |
| `deliveryMode` | String | default `cloud` (`cloud`/`direct`/`webrtc`) |
| `status` | String | default `created` |
| `checksum`, `errorCode`, `errorMessage` | String? | nullable |
| `fileSize` | Int? | nullable |
| `startedAt`, `completedAt`, `createdAt`, `updatedAt` | DateTime | defaults |

Indexes: `@@index([shopId, status])`, `@@index([agentId])`, `@@index([printJobId])`.

### 1.14 `FileCleanupTask` (`schema.prisma:307`)

| Field | Type | Constraint |
|---|---|---|
| `id` | String | `@id @default(uuid())` |
| `printFileId`, `shopId`, `storageKey` | String | required |
| `cleanupType` | String | default `after_receipt` |
| `scheduledAt` | DateTime | required |
| `completedAt` | DateTime? | nullable |
| `attempts` | Int | default `0` |
| `maxAttempts` | Int | default `5` |
| `lastError` | String? | nullable |
| `status` | String | default `pending` |
| `createdAt`, `updatedAt` | DateTime | defaults |

Indexes: `@@index([shopId, status])`, `@@index([scheduledAt])`, `@@index([printFileId])`.

---

## 2. Migration history

```
prisma/
├── migrations/
│   ├── migration_lock.toml                          # provider = "postgresql"
│   ├── 20261015172034_init/migration.sql            # SQLite SQL (DATETIME types!)
│   └── 20251108000000_add_delivery_and_sync/migration.sql  # additive Postgres SQL
├── schema.prisma                                    # provider = "postgresql"
└── pg-constraints.sql                               # extra raw constraints
```

### 2.1 `migration_lock.toml`

```toml
provider = "postgresql"
```
Currently locked to PostgreSQL. **VERIFIED**.

### 2.2 `20261015172034_init/migration.sql` (the original init)

This migration was generated against **SQLite** — the SQL uses `DATETIME`
column types and `DATETIME DEFAULT CURRENT_TIMESTAMP`
(`prisma/migrations/20261015172034_init/migration.sql:16-18`). It also
defines the `Subscription` table with `startedAt`/`expiresAt` columns
that don't match the current schema (`currentPeriodStart`/`currentPeriodEnd`).

> FIND-020 (P1): The init migration was generated for SQLite but is
> checked in alongside `migration_lock.toml = postgresql`. Running
> `prisma migrate deploy` against a fresh PostgreSQL database would
> apply this SQLite-flavored SQL — the `DATETIME` types happen to be
> accepted by Postgres (it falls back to `timestamp`), but the schema
> it produces does NOT match the current `schema.prisma` (the
> `Subscription` columns diverge, the partial unique index
> `PrintJob_active_file_unique` is missing, the Phase 5-7 tables are
> missing). This is **schema drift** between `schema.prisma` and the
> applied migrations.

### 2.3 `20251108000000_add_delivery_and_sync/migration.sql`

Additive migration: adds `DeviceSyncState`, `Customer`,
`PrintDeliveryAttempt`, `FileCleanupTask`. Uses Postgres-compatible
SQL (`TIMESTAMP(3)`, `TEXT`). Dated 2025-11-08 (BEFORE the init
migration's 2026-10-15 timestamp — the dates are out of order, but
Prisma sorts by filename not date semantics, so this is harmless).

### 2.4 How production was ACTUALLY provisioned

Per the audit context and `docs/DATABASE_MIGRATION_AUDIT.md`, production
was set up via the **`POST /api/v1/setup-database?key=…` endpoint**
(`src/app/api/v1/setup-database/route.ts`), NOT via `prisma migrate deploy`.
This endpoint runs an inline `SETUP_SQL` block
(`src/app/api/v1/setup-database/route.ts:54-218`) that:

1. Creates all 14 tables with `CREATE TABLE IF NOT EXISTS` (Postgres syntax).
2. Creates all indexes with `CREATE [UNIQUE] INDEX IF NOT EXISTS`.
3. Adds foreign keys with `ALTER TABLE … ADD CONSTRAINT IF NOT EXISTS`.
4. Adds the partial unique index `PrintJob_active_file_unique` (line 39).
5. Adds `tokenHash` to `PrintAgent` via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

This bypasses the Prisma migration system entirely. The Prisma
`_prisma_migrations` table is therefore NOT populated in production.

> FIND-021 (P0): Production schema state is invisible to
> `prisma migrate status`. The `_prisma_migrations` table is empty (or
> absent), so Prisma thinks no migrations have been applied. Running
> `prisma migrate deploy` against the production DB would attempt to
> apply the SQLite-flavored `20261015172034_init` migration, which
> would either succeed (creating duplicate tables — `IF NOT EXISTS`
> saves it) or fail (constraint conflicts). **This is a P0 schema-drift
> risk.** Future schema changes MUST be applied via either (a) a
> corrected `prisma migrate` workflow, or (b) extending the
> `setup-database` SQL — pick ONE and document it.

> FIND-022 (P1): The `setup-database` SQL drifts from `schema.prisma`
> in at least two places: (a) `Subscription` uses `startedAt`/`expiresAt`
> in setup-SQL but `currentPeriodStart`/`currentPeriodEnd` in schema;
> (b) the partial `PrintJob_active_file_unique` index is only in
> setup-SQL, not in any migration. Any developer running
> `prisma migrate reset` locally will get a different schema than
> production.

> FIND-023 (P2): `prisma/pg-constraints.sql` exists at the repo root
> of `prisma/` but is **not referenced by any migration or script**
> (verified by `Grep`-ing the repo). It appears to be dead code or
> a manual-apply artifact. Recommend deleting or wiring into a
> documented migration.

## 3. Tenant isolation summary

| Model | `shopId`? | Tenant enforcement |
|---|---|---|
| Shop | (root) | n/a |
| User | nullable | `findById`, `findByEmail`, `findByShop(shopId)` |
| Order | ✓ | `findByIdAndShop`, `listByShop(shopId)` |
| PrintFile | ✗ | via parent Order (`findByIdAndOrderAndShop`) |
| PrintJob | ✓ | `findQueuedByShop(shopId)`, partial unique on `fileId` |
| PrintAgent | ✓ | `findByIdAndShop` |
| Subscription | ✓ unique | `findByShop(shopId)` |
| AuditLog | nullable | `findByShop(shopId, …)`, `listRecent(limit)` for admin |
| PaymentAttempt | ✓ | via repos queries |
| PaymentEvent | ✗ | via parent PaymentAttempt |
| DeviceSyncState | ✓ | `getOrCreateSyncState(shopId, deviceId)` |
| Customer | ✓ | `pullSince(shopId, cursor)` |
| PrintDeliveryAttempt | ✓ | via `shopId` direct |
| FileCleanupTask | ✓ | `processCleanupTasks(limit)` — shopId retained |

3 of 14 models rely on parent-row joins for tenant isolation
(`PrintFile`, `PaymentEvent`, plus `AuditLog` for cross-shop admin
queries). All others carry a direct `shopId`.

## 4. Database audit summary

- 14 models, all with `createdAt`; 13 of 14 with `updatedAt`
  (`AuditLog` is append-only).
- 9 of 14 carry a direct `shopId` tenant column.
- Schema is PostgreSQL (Supabase) — verified via
  `schema.prisma:6` and `migration_lock.toml`.
- Production was provisioned via `setup-database` endpoint, not
  `prisma migrate deploy` — Prisma's migration state is invisible.
- Two schema-drift risks: FIND-020 (SQLite init SQL) and FIND-022
  (Subscription column names diverge).
- The partial unique index on PrintJob is load-bearing for idempotency
  but exists only in setup-SQL — FIND-019 (P1).

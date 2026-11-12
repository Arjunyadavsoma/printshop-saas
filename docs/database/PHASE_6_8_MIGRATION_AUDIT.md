# Phase 6.8 — Migration Chain Audit

**Branch:** `phase-6-8-migration-chain-repair`
**Date:** 2026-11-10
**Scope:** Audit and repair of the Prisma migration chain so it applies cleanly
to PostgreSQL 17.11 via `prisma migrate deploy`.

---

## 1. Migration dependency map

The 4 migrations in `prisma/migrations/` form a strict dependency chain.
Applying them out of order breaks the chain because every migration after
`init` adds foreign keys or indexes that reference tables created by an
earlier migration.

| Order | Migration directory                            | Creates / modifies                                            | Depends on                                  |
| ----- | ---------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| 1     | `20251107000000_init`                          | Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription, AuditLog + their FKs and indexes | — (baseline)                                |
| 2     | `20251108000000_add_delivery_and_sync`         | DeviceSyncState, Customer, PrintDeliveryAttempt, FileCleanupTask | Shop (FK target — none of these tables add FKs to Shop/Order in this migration; they are additive-only with logical references) |
| 3     | `20251110000000_add_active_attempt_unique_index` | PaymentAttempt, PaymentEvent, partial unique index `PaymentAttempt_active_order_unique`, unique index `PaymentEvent_provider_eventId_key` | — (creates tables WITHOUT FKs to Shop/Order; FKs are added in the next migration) |
| 4     | `20261015172035_add_payment_fk_constraints`    | FK `PaymentAttempt_shopId_fkey`, FK `PaymentAttempt_orderId_fkey`, FK `PaymentEvent_attemptId_fkey` | Shop (from #1), Order (from #1), PaymentAttempt (from #3) |

### Why ordering matters

* `20261015172035_add_payment_fk_constraints` runs `ALTER TABLE ... ADD
  CONSTRAINT ... FOREIGN KEY ("orderId") REFERENCES "Order"`. This fails
  with `relation "Order" does not exist` if the `init` migration has not
  run first.
* The `PaymentEvent.attemptId` FK references `PaymentAttempt.id`, which
  is created by `20251110000000_add_active_attempt_unique_index`. The
  FK-constraint migration therefore MUST run after migration #3.

### Pre-repair state (broken)

| Directory                                    | Timestamp    | Position in chain (broken)   |
| -------------------------------------------- | ------------ | ---------------------------- |
| `20251108000000_add_delivery_and_sync`       | 2025-11-08   | 1                            |
| `20251110000000_add_active_attempt_unique_index` | 2025-11-10 | 2 (NOT applied in broken tree — file absent) |
| `20261015172035_add_payment_fk_constraints`  | 2026-10-15   | 3 (NOT applied in broken tree — file absent) |
| `20261015172034_init`                        | 2026-10-15   | 4 (WRONG — runs LAST but creates the tables every other migration depends on) |

Two independent problems:

1. The init migration was timestamped `20261015172034`, so `prisma migrate
   deploy` ran it LAST. This caused migrations #2 and #3 to fail because the
   Shop / Order / User tables they reference did not exist yet.
2. The init migration used SQLite's `DATETIME` type — PostgreSQL rejects
   `DATETIME` with a syntax error, so the migration could not apply even
   when it was reached.

### Post-repair state (correct)

| Directory                                    | Timestamp    | Position in chain (correct)  |
| -------------------------------------------- | ------------ | ---------------------------- |
| `20251107000000_init`                        | 2025-11-07   | 1                            |
| `20251108000000_add_delivery_and_sync`       | 2025-11-08   | 2                            |
| `20251110000000_add_active_attempt_unique_index` | 2025-11-10 | 3                            |
| `20261015172035_add_payment_fk_constraints`  | 2026-10-15   | 4                            |

The new init timestamp `20251107000000` (2025-11-07) places it one day
BEFORE the delivery/sync migration and four days before the payment-tables
migration. The FK-constraints migration retains its original `20261015172035`
timestamp — it correctly runs last because FK targets (Shop, Order,
PaymentAttempt) all exist by then.

---

## 2. DATETIME → TIMESTAMP(3) fix

### Why it broke

Prisma's SQLite generator emits `DATETIME` for `DateTime` fields. When the
`init` migration was originally generated, the Prisma datasource was SQLite
(the project's local dev DB is `file:./db/custom.db`). The migration was
later promoted to be the production baseline without re-targeting PostgreSQL.

PostgreSQL has no `DATETIME` type — its closest equivalents are `TIMESTAMP`
(`TIMESTAMP WITHOUT TIME ZONE`) and `TIMESTAMPTZ` (`TIMESTAMP WITH TIME
ZONE`). Prisma's PostgreSQL generator emits `TIMESTAMP(3)` for `DateTime`
fields. The fix is therefore a 1-for-1 textual substitution:

```
DATETIME  →  TIMESTAMP(3)
```

### Scope of the fix

Applied to `prisma/migrations/20261015172034_init/migration.sql` (now
`20251107000000_init/migration.sql`). 24 occurrences across 8 tables:

| Table          | DATETIME columns |
| -------------- | ---------------- |
| Shop           | `subscriptionExpiresAt`, `createdAt`, `updatedAt` (3) |
| User           | `createdAt`, `updatedAt` (2) |
| Order          | `paidAt`, `createdAt`, `updatedAt` (3) |
| PrintFile      | `printedAt`, `createdAt`, `updatedAt` (3) |
| PrintJob       | `queuedAt`, `startedAt`, `completedAt`, `createdAt`, `updatedAt` (5) |
| PrintAgent     | `lastSeenAt`, `createdAt`, `updatedAt` (3) |
| Subscription   | `currentPeriodStart`, `currentPeriodEnd`, `createdAt`, `updatedAt` (4) |
| AuditLog       | `createdAt` (1) |
| **Total**      | **24** |

### Other SQLite-isms checked

| SQLite-only syntax     | Present in init? | Action |
| ---------------------- | ---------------- | ------ |
| `AUTOINCREMENT`        | No               | — |
| `INTEGER PRIMARY KEY`  | No (uses `TEXT NOT NULL PRIMARY KEY`) | — |
| `sqlite_*` functions   | No               | — |
| `WITHOUT ROWID`        | No               | — |
| `PRAGMA`               | No               | — |

The init migration is otherwise standard SQL and applies to PostgreSQL as
soon as `DATETIME` is replaced. No further substitutions were necessary.

### `CURRENT_TIMESTAMP` default

The init migration uses `DEFAULT CURRENT_TIMESTAMP` on `createdAt` columns.
PostgreSQL's `CURRENT_TIMESTAMP` returns a `TIMESTAMP WITH TIME ZONE`; when
the column is declared as `TIMESTAMP(3)` (without time zone) PostgreSQL
implicitly casts and stores the local-time interpretation. This is the same
behaviour Prisma's own PostgreSQL generator produces, so no change was
required.

---

## 3. Ordering fix

### Mechanism

The migration directory is renamed in place:

```bash
git mv prisma/migrations/20261015172034_init prisma/migrations/20251107000000_init
```

Prisma identifies migrations by the directory name's leading timestamp
(`YYYYMMDDHHmmss`). `prisma migrate deploy` applies migrations in
lexicographic order of this timestamp, so renaming the directory is the
authoritative way to control application order.

### Compatibility with production

The production deploy uses `pg-migrate-prod.sh`, which uses
`prisma migrate diff` (NOT `prisma migrate deploy`). This script computes a
SQL diff between the migration files and the target database and applies
the resulting SQL directly. It does not consult the `_prisma_migrations`
history table — the migration history is implicit in the diff.

The `_prisma_migrations` table in production was verified to be empty in
Phase 6.6 (`docs/payments/PHASE_6_6_INDEPENDENT_PAYMENT_AUDIT.md`). The
production database is therefore treated as having NO migration history —
every deploy is a from-scratch diff. Renaming the init directory and
rewriting its SQL is therefore safe in production.

If `prisma migrate deploy` were used in production (it is not), the
existing `_prisma_migrations` rows that referenced the old migration name
`20261015172034_init` would need reconciliation — either by deleting the
stale row or by `prisma migrate resolve --rolled-back`. This is not a
concern under the actual deploy model.

### Compatibility with the test suite

The test databases `printshop_test` and `printshop_clean` are created
from scratch (DROP + CREATE) before each `prisma migrate deploy`. The new
ordering is applied automatically — no test fixture changes were required.

---

## 4. Verification summary

| Check                                    | Result |
| ---------------------------------------- | ------ |
| `prisma migrate deploy` on clean PostgreSQL 17.11 | ALL 4 migrations applied successfully |
| Tables created                           | 14 application tables (Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription, AuditLog, DeviceSyncState, Customer, PrintDeliveryAttempt, FileCleanupTask, PaymentAttempt, PaymentEvent) |
| Partial unique index                     | `PaymentAttempt_active_order_unique` verified (WHERE status='created') |
| PaymentEvent FK                           | `PaymentEvent_attemptId_fkey` → PaymentAttempt(id) verified |
| PaymentAttempt FKs                        | `PaymentAttempt_shopId_fkey` → Shop(id), `PaymentAttempt_orderId_fkey` → Order(id) verified |
| Total FK constraints                     | 12 (verified via `pg_constraint`) |
| Migration integrity regression tests     | 7/7 pass (raw `pg` driver, raw SQL) |

See `docs/database/PHASE_6_8_MIGRATION_VERIFICATION.md` for the exact
`prisma migrate deploy` output, full table/index/FK listings, and test
output.

---

## 5. Filesystem changes

```
prisma/migrations/20251107000000_init/migration.sql          (renamed from 20261015172034_init, DATETIME → TIMESTAMP(3))
prisma/migrations/20251108000000_add_delivery_and_sync/migration.sql  (unchanged)
prisma/migrations/20251110000000_add_active_attempt_unique_index/migration.sql  (unchanged — restored from Phase 6.7)
prisma/migrations/20261015172035_add_payment_fk_constraints/migration.sql  (unchanged — restored from Phase 6.7)
src/lib/pricing/migration-integrity.test.ts                 (NEW — 7 regression scenarios)
docs/database/PHASE_6_8_MIGRATION_AUDIT.md                  (NEW — this file)
docs/database/PHASE_6_8_MIGRATION_VERIFICATION.md           (NEW — verification output)
```

---

## 6. Lessons learned

1. **Prisma migration files are NOT cross-engine portable.** A migration
   generated against SQLite cannot be applied to PostgreSQL without
   editing the SQL. When the project switches the datasource provider,
   the existing migrations must be regenerated or hand-edited.
2. **Migration ordering is controlled by directory name, not by file
   content.** A migration that creates baseline tables MUST have the
   earliest timestamp; otherwise every downstream migration that
   references those tables will fail.
3. **`prisma migrate deploy` strictly applies migrations in directory
   order.** It does NOT perform topological sorting based on table
   dependencies. The author of the migration is responsible for getting
   the order right.
4. **`prisma migrate diff` (production) vs `prisma migrate deploy`
   (tests)** have different semantics around migration history. The diff
   approach is stateless and idempotent; the deploy approach is stateful
   and remembers applied migrations in `_prisma_migrations`. The
   production deploy script uses `diff` specifically to avoid history
   reconciliation headaches during schema churn.

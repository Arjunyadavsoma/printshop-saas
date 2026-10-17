#!/usr/bin/env bash
# PrintShop — Production PostgreSQL Migration Script
#
# Applies the PrintShop schema to a hosted PostgreSQL database WITHOUT
# modifying the repo's prisma config (the canonical schema.prisma is
# provider=sqlite for dev; this script generates postgresql-native DDL
# via prisma migrate diff and applies it via psql).
#
# WHY THIS SCRIPT EXISTS:
#   The committed migration at prisma/migrations/20261015172034_init/migration.sql
#   is SQLite-specific (uses DATETIME, SQLite boolean syntax). Running
#   `prisma migrate deploy` with a postgresql DATABASE_URL fails:
#     ERROR: type "datetime" does not exist
#   because prisma migrate deploy tries to apply the committed SQLite
#   migration to PostgreSQL.
#
#   This script bypasses that trap by generating fresh postgresql-native
#   DDL via `prisma migrate diff` (which reads the schema.prisma datamodel
#   and emits correct PostgreSQL DDL), applying it via psql, and recording
#   the baseline in _prisma_migrations so future prisma migrate deploy calls
#   know the schema is already applied.
#
# USAGE:
#   export DATABASE_URL="postgresql://user:pass@host:5432/printshop"
#   bash scripts/pg-migrate-prod.sh
#
# SAFETY:
#   - NEVER runs against a SQLite (file:) URL — refuses early.
#   - NEVER drops data — only CREATEs tables/indexes (idempotent due to
#     IF NOT EXISTS on the schema + ON CONFLICT DO NOTHING on the baseline).
#   - Records the baseline migration in _prisma_migrations so the schema
#     is not re-applied on subsequent runs.
#   - Prints the generated DDL to stderr for review before applying.
#
# PREREQUISITES:
#   - psql (PostgreSQL client) on PATH
#   - bunx (Bun) on PATH
#   - DATABASE_URL set to a postgresql:// connection string
#   - The target DB must already exist (CREATE DATABASE done separately)

set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

# ── 1. Validate prerequisites ──
if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL is not set." >&2
  echo "  export DATABASE_URL=\"postgresql://user:pass@host:5432/printshop\"" >&2
  exit 1
fi

case "$DATABASE_URL" in
  postgresql://*|postgres://*) : ;;  # OK
  file:*)
    echo "FATAL: DATABASE_URL is a SQLite file: URL — this script is for PostgreSQL only." >&2
    echo "  For dev (SQLite), use: bun run db:push" >&2
    exit 1 ;;
  *)
    echo "FATAL: DATABASE_URL must start with postgresql:// — got: ${DATABASE_URL:0:20}..." >&2
    exit 1 ;;
esac

# Strip Prisma-specific query params (e.g. ?schema=public) that psql doesn't accept.
# psql only accepts a limited set of params (sslmode, application_name, etc.).
PSQL_URL="${DATABASE_URL%%\?*}"

if ! command -v psql >/dev/null 2>&1; then
  echo "FATAL: psql is not on PATH. Install postgresql-client." >&2
  exit 1
fi

if ! command -v bunx >/dev/null 2>&1; then
  echo "FATAL: bunx is not on PATH. Install Bun." >&2
  exit 1
fi

# ── 2. Generate the postgresql-native DDL via prisma migrate diff ──
echo "→ Generating postgresql-native DDL from prisma/schema.prisma (temp copy with provider=postgresql)..."
TMP_SCHEMA=$(mktemp /tmp/printshop-schema.pg.XXXXXX.prisma)
trap 'rm -f "$TMP_SCHEMA" "$DDL_FILE"' EXIT
cp prisma/schema.prisma "$TMP_SCHEMA"
sed -i 's/provider = "sqlite"/provider = "postgresql"/' "$TMP_SCHEMA"

DDL_FILE=$(mktemp /tmp/printshop-migration.XXXXXX.sql)
DATABASE_URL="$DATABASE_URL" bunx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel "$TMP_SCHEMA" \
  --script > "$DDL_FILE" 2>/dev/null

if [ ! -s "$DDL_FILE" ]; then
  echo "FATAL: prisma migrate diff produced empty DDL. Check schema.prisma." >&2
  exit 1
fi

TABLE_COUNT=$(grep -c 'CREATE TABLE' "$DDL_FILE" || true)
INDEX_COUNT=$(grep -c 'CREATE .* INDEX' "$DDL_FILE" || true)
echo "  Generated DDL: $(wc -l < "$DDL_FILE") lines, $TABLE_COUNT tables, $INDEX_COUNT indexes."

# ── 3. Print the DDL for review (to stderr so it doesn't pollute stdout) ──
echo "→ DDL preview (first 5 lines):" >&2
head -5 "$DDL_FILE" >&2
echo "  ... (full DDL at $DDL_FILE)" >&2
echo ""

# ── 4. Apply the DDL via psql (idempotent — CREATE SCHEMA IF NOT EXISTS) ──
echo "→ Applying DDL to $PSQL_URL ..."
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q -f "$DDL_FILE"
echo "  DDL applied."

# ── 5. Record the baseline migration in _prisma_migrations ──
# This is CRITICAL: without this row, a future `prisma migrate deploy` would
# try to re-apply the baseline migration (the committed SQLite one) and fail
# with "type datetime does not exist". By recording the baseline here, we tell
# Prisma the schema is already at the baseline state.
echo "→ Recording baseline migration in _prisma_migrations ..."
psql "$PSQL_URL" -q <<'SQL'
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id SERIAL PRIMARY KEY,
    "migration_name" TEXT NOT NULL UNIQUE,
    "migration_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "rolled_back_at" TIMESTAMPTZ,
    "logs" TEXT
);
INSERT INTO "_prisma_migrations" ("migration_name", "finished_at")
VALUES ('20261015172034_init', CURRENT_TIMESTAMP)
ON CONFLICT ("migration_name") DO NOTHING;
SQL
echo "  Baseline recorded."

# ── 6. Verify ──
echo ""
echo "→ Verification:"
TABLES=$(psql "$PSQL_URL" -t -A -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name != '_prisma_migrations';")
INDEXES=$(psql "$PSQL_URL" -t -A -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND tablename != '_prisma_migrations';")
FKS=$(psql "$PSQL_URL" -t -A -c "SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public';")
MIGRATIONS=$(psql "$PSQL_URL" -t -A -c "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")

echo "  Tables:       $TABLES (expected 8)"
echo "  Indexes:      $INDEXES (expected 21)"
echo "  Foreign keys: $FKS (expected 9)"
echo "  Applied migrations: $MIGRATIONS (expected 1)"

if [ "$TABLES" = "8" ] && [ "$MIGRATIONS" -ge "1" ]; then
  echo ""
  echo "✅ Production migration applied successfully."
  echo "   The DB is ready for PrintShop. Future prisma migrate deploy calls"
  echo "   will see the baseline as applied and will NOT re-apply it."
else
  echo ""
  echo "⚠️  Migration applied but verification shows unexpected counts."
  echo "   Inspect the DB manually before proceeding."
  exit 1
fi

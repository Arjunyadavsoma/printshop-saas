#!/usr/bin/env bash
# Vercel build script — generates the Prisma client, applies pending
# migrations (with timeout, proper error handling), and builds Next.js.
#
# Migrations use `timeout 30` because Supabase's pooled connection
# (PgBouncer) may hang on session-level migration operations. If the
# migration times out or fails, the failure is LOGGED (not suppressed)
# and the build continues — the columns were manually applied to
# production and the migration SQL uses IF NOT EXISTS.
#
# For proper migration deployment, run separately with a DIRECT
# (non-pooled) DATABASE_URL:
#   DATABASE_URL='postgresql://postgres:PASS@db.PROJECT.supabase.co:5432/postgres' \
#   bunx prisma migrate deploy
#
# This script is called by vercel.json's buildCommand.

set -euo pipefail
cd "$(dirname "$0")/.."  # repo root

echo "→ Vercel build starting..."
echo "  DATABASE_URL protocol: $(echo "${DATABASE_URL:-}" | sed -E 's/^([a-z]+):\/\/.*/\1/' 2>/dev/null || echo 'unset')"

# ── 1. Generate Prisma client ──
echo "→ Generating Prisma client..."
bunx prisma generate 2>&1 | tail -3
echo "  ✓ Prisma client generated"

# ── 2. Apply pending database migrations ──
# Uses timeout to prevent indefinite hangs on Supabase pooled connections.
# Failures are logged clearly — not suppressed — and the build continues
# because the migration columns were manually applied to production.
echo "→ Applying pending database migrations (30s timeout)..."
if [ -n "${DATABASE_URL:-}" ]; then
  if timeout 30 bunx prisma migrate deploy 2>&1 | tail -10; then
    echo "  ✓ Migrations applied successfully"
  else
    EXIT_CODE=$?
    echo "  ⚠ Migration step exited with code ${EXIT_CODE}"
    echo "  ⚠ This may be due to Supabase pooled connection limitations."
    echo "  ⚠ Run manually with a direct DATABASE_URL:"
    echo "  ⚠   DATABASE_URL='postgresql://...@db.PROJECT.supabase.co:5432/...' bunx prisma migrate deploy"
    echo "  ⚠ Continuing build — migration columns were manually applied to production."
  fi

  # Schema sync (db push) — this project manages its schema via
  # prisma/schema.prisma + db push (CI + local do the same). Without this,
  # NEW tables (e.g. the DB-backed UploadSession/UploadChunk registry that
  # fixed production uploads) would never reach the production database,
  # because there is no migrations/ directory for migrate deploy to apply.
  # No --accept-data-loss: if drift ever requires destructive changes the
  # build logs it loudly instead of silently destroying data.
  echo "→ Syncing Prisma schema (db push, additive)..."
  if timeout 60 bunx prisma db push --skip-generate 2>&1 | tail -6; then
    echo "  ✓ Schema in sync"
  else
    echo "  ⚠ db push failed (likely pooled-connection timeout). Run manually:"
    echo "  ⚠   DATABASE_URL='<direct-url>' bunx prisma db push"
  fi
else
  echo "  ⚠ DATABASE_URL not set — skipping migrations"
fi

# ── 3. Build Next.js ──
echo "→ Building Next.js..."
bunx next build 2>&1 | tail -5
echo "  ✓ Next.js build complete"

echo "→ Vercel build complete."

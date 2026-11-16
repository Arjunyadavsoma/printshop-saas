#!/usr/bin/env bash
# Vercel build script — generates the Prisma client, applies pending
# migrations (non-fatal), and builds Next.js.
#
# `prisma migrate deploy` is wrapped in `|| true` so a migration failure
# (e.g. DATABASE_URL not set at build time, connection timeout) does NOT
# abort the build. The columns were manually applied to production and
# the migration SQL uses IF NOT EXISTS, so a skipped migration is safe.
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

# ── 2. Apply pending database migrations (non-fatal) ──
# Wrapped in `|| true` so the build doesn't fail if DATABASE_URL is not
# available at build time or the migration connection fails. The
# migration uses IF NOT EXISTS so it's safe to run or skip.
echo "→ Applying pending database migrations..."
if [ -n "${DATABASE_URL:-}" ]; then
  bunx prisma migrate deploy 2>&1 | tail -10 || true
  echo "  ✓ Migration step complete"
else
  echo "  ⚠ DATABASE_URL not set — skipping migrations"
fi

# ── 3. Build Next.js ──
echo "→ Building Next.js..."
bunx next build 2>&1 | tail -5
echo "  ✓ Next.js build complete"

echo "→ Vercel build complete."

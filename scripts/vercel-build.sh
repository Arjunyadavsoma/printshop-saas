#!/usr/bin/env bash
# Vercel build script — generates the Prisma client, applies pending
# migrations, and builds Next.js.
#
# CRITICAL: `prisma migrate deploy` runs BEFORE `next build` so the
# database schema is always in sync with the deployed code. Without
# this, a deployment that adds new columns will crash at runtime
# (e.g. "column does not exist" errors).
#
# This script is called by vercel.json's buildCommand.

set -euo pipefail
cd "$(dirname "$0")/.."  # repo root

echo "→ Vercel build starting..."
echo "  DATABASE_URL protocol: $(echo "$DATABASE_URL" | sed -E 's/^([a-z]+):\/\/.*/\1/' 2>/dev/null || echo 'unset')"

# ── 1. Generate Prisma client ──
echo "→ Generating Prisma client..."
bunx prisma generate 2>&1 | tail -3
echo "  ✓ Prisma client generated"

# ── 2. Apply pending database migrations ──
echo "→ Applying pending database migrations..."
if [ -n "${DATABASE_URL:-}" ]; then
  bunx prisma migrate deploy 2>&1 | tail -10
  echo "  ✓ Migrations applied"
else
  echo "  ⚠ DATABASE_URL not set — skipping migrations (development only)"
fi

# ── 3. Build Next.js ──
echo "→ Building Next.js..."
bunx next build 2>&1 | tail -5
echo "  ✓ Next.js build complete"

echo "→ Vercel build complete."

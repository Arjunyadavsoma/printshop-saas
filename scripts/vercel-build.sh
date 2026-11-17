#!/usr/bin/env bash
# Vercel build script — generates the Prisma client, applies pending
# migrations (with timeout, non-fatal), and builds Next.js.
#
# `prisma migrate deploy` is wrapped in `timeout 30 ... || true` so:
#   1. If it hangs (e.g. Supabase pooled connection doesn't support
#      migration session operations), it's killed after 30s.
#   2. If it fails (connection refused, SSL error), the build continues.
#   3. If it succeeds, migrations are applied.
# The migration SQL uses IF NOT EXISTS and the columns were manually
# applied to production, so a skipped migration is safe.
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

# ── 2. Apply pending database migrations (30s timeout, non-fatal) ──
echo "→ Applying pending database migrations (30s timeout)..."
if [ -n "${DATABASE_URL:-}" ]; then
  timeout 30 bunx prisma migrate deploy 2>&1 | tail -10 || true
  echo "  ✓ Migration step complete (may have been skipped or timed out)"
else
  echo "  ⚠ DATABASE_URL not set — skipping migrations"
fi

# ── 3. Build Next.js ──
echo "→ Building Next.js..."
bunx next build 2>&1 | tail -5
echo "  ✓ Next.js build complete"

echo "→ Vercel build complete."

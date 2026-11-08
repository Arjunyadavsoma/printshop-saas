#!/usr/bin/env bash
# Vercel build script — generates the Prisma client + builds Next.js.
#
# The schema.prisma now permanently declares provider = "postgresql"
# (matching production Supabase). The old sqlite↔postgresql switching
# logic has been removed — it was a no-op since the schema already
# had postgresql.
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

# ── 2. Build Next.js ──
echo "→ Building Next.js..."
bunx next build 2>&1 | tail -5
echo "  ✓ Next.js build complete"

echo "→ Vercel build complete."

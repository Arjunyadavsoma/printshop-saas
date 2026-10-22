#!/usr/bin/env bash
# Vercel build script — handles the dual-provider (SQLite dev / PostgreSQL prod)
# challenge by switching the Prisma schema provider at build time.
#
# Vercel sets DATABASE_URL in the environment. If it's a postgresql:// URL,
# we temporarily switch schema.prisma to provider=postgresql, generate the
# Prisma client, build Next.js, then restore the canonical SQLite schema.
#
# This script is called by vercel.json's buildCommand.

set -euo pipefail
cd "$(dirname "$0")/.."  # repo root

echo "→ Vercel build starting..."
echo "  DATABASE_URL protocol: $(echo "$DATABASE_URL" | sed -E 's/^([a-z]+):\/\/.*/\1/' 2>/dev/null || echo 'unset')"

# ── 1. Switch Prisma provider if DATABASE_URL is PostgreSQL ──
if echo "$DATABASE_URL" | grep -q '^postgresql://\|^postgres://'; then
  echo "→ DATABASE_URL is PostgreSQL — switching schema.prisma provider..."
  cp prisma/schema.prisma /tmp/schema.sqlite.VERCEL.bak
  sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
  echo "  ✓ Switched to provider=postgresql"
else
  echo "→ DATABASE_URL is not PostgreSQL — keeping provider=sqlite (dev mode)"
fi

# ── 2. Generate Prisma client ──
echo "→ Generating Prisma client..."
bunx prisma generate 2>&1 | tail -3
echo "  ✓ Prisma client generated"

# ── 3. Build Next.js (without the Docker cp commands) ──
echo "→ Building Next.js..."
bunx next build 2>&1 | tail -5
echo "  ✓ Next.js build complete"

# ── 4. Restore the canonical SQLite schema ──
if [ -f /tmp/schema.sqlite.VERCEL.bak ]; then
  cp /tmp/schema.sqlite.VERCEL.bak prisma/schema.prisma
  rm -f /tmp/schema.sqlite.VERCEL.bak
  echo "  ✓ Restored canonical SQLite schema.prisma"
fi

echo "→ Vercel build complete."

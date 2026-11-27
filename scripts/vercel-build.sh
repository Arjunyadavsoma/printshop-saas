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

  # Surgical table creation FIRST (prisma db execute — idempotent DDL, no
  # data-loss classification): `prisma db push` is all-or-nothing, and the
  # production database currently has an unrelated drift (it wants to add
  # the Order.[shopId, customerToken] unique constraint → db push refuses
  # without --accept-data-loss and would skip creating ANY new tables).
  # The upload-session registry must exist for durable sessions, so create
  # it directly from scripts/ensure-upload-tables.sql (CREATE TABLE IF NOT
  # EXISTS — safe to run on every deploy, touches nothing else).
  echo "→ Ensuring upload-session tables (idempotent SQL)..."
  SQL_OK=0
  for ATTEMPT in 1 2 3; do
    if timeout 30 bun scripts/run-sql-file.mjs scripts/ensure-upload-tables.sql 2>&1 | tail -20; then
      echo "  ✓ Upload-session tables present (attempt ${ATTEMPT})"
      SQL_OK=1
      break
    fi
    echo "  ⚠ db execute attempt ${ATTEMPT} failed — retrying in 15s..."
    sleep 15
  done
  if [ "$SQL_OK" -ne 1 ]; then
    echo "  ⚠ Could not create upload-session tables — uploads fall back to in-process storage."
  fi

  # Surgical customer-account table creation (same pattern as the upload
  # tables above): `prisma db push` is all-or-nothing and refuses on the
  # Order.[shopId, customerToken] drift, so the CustomerAccount table and
  # Order.customerId column would never be created by db push. Create
  # them directly from scripts/ensure-customer-tables.sql (CREATE TABLE /
  # ADD COLUMN IF NOT EXISTS — safe to run on every deploy, touches
  # nothing else). Without this, the customer Google sign-in exchange
  # fails on its first write (no such table).
  echo "→ Ensuring customer-account tables (idempotent SQL)..."
  CUSTOMER_SQL_OK=0
  for ATTEMPT in 1 2 3; do
    if timeout 30 bun scripts/run-sql-file.mjs scripts/ensure-customer-tables.sql 2>&1 | tail -20; then
      echo "  ✓ Customer-account tables present (attempt ${ATTEMPT})"
      CUSTOMER_SQL_OK=1
      break
    fi
    echo "  ⚠ db execute attempt ${ATTEMPT} failed — retrying in 15s..."
    sleep 15
  done
  if [ "$CUSTOMER_SQL_OK" -ne 1 ]; then
    echo "  ⚠ Could not create customer-account tables — customer Google sign-in will fail until they exist."
  fi

  # Surgical refund + payment-idempotency table/index creation (Feature 4 —
  # Checkout & Payments): the Refund model, partial unique on Payment.utr,
  # partial unique on Payment(orderId,method) for active statuses, and
  # partial unique on PaymentAttempt.providerTransactionId. Same idempotent
  # IF NOT EXISTS pattern as the upload/customer scripts above.
  echo "→ Ensuring refund + payment-idempotency tables (idempotent SQL)..."
  REFUND_SQL_OK=0
  for ATTEMPT in 1 2 3; do
    if timeout 30 bun scripts/run-sql-file.mjs scripts/ensure-refund-tables.sql 2>&1 | tail -20; then
      echo "  ✓ Refund + payment-idempotency tables present (attempt ${ATTEMPT})"
      REFUND_SQL_OK=1
      break
    fi
    echo "  ⚠ db execute attempt ${ATTEMPT} failed — retrying in 15s..."
    sleep 15
  done
  if [ "$REFUND_SQL_OK" -ne 1 ]; then
    echo "  ⚠ Could not create refund tables — refund flow will fail until they exist."
  fi

  # Gmail connection + payment evidence tables (Phase E + F)
  echo "→ Ensuring Gmail + reconciliation tables (idempotent SQL)..."
  GMAIL_SQL_OK=0
  for ATTEMPT in 1 2 3; do
    if timeout 30 bun scripts/run-sql-file.mjs scripts/ensure-gmail-reconciliation-tables.sql 2>&1 | tail -20; then
      echo "  ✓ Gmail + reconciliation tables present (attempt ${ATTEMPT})"
      GMAIL_SQL_OK=1
      break
    fi
    echo "  ⚠ db execute attempt ${ATTEMPT} failed — retrying in 15s..."
    sleep 15
  done
  if [ "$GMAIL_SQL_OK" -ne 1 ]; then
    echo "  ⚠ Could not create Gmail tables — Gmail reconciliation will fail until they exist."
  fi

  # Schema sync (db push) — this project manages its schema via
  # prisma/schema.prisma + db push (CI + local do the same). Without this,
  # NEW tables (e.g. the DB-backed UploadSession/UploadChunk registry that
  # fixed production uploads) would never reach the production database,
  # because there is no migrations/ directory for migrate deploy to apply.
  # No --accept-data-loss: if drift ever requires destructive changes the
  # build logs it loudly instead of silently destroying data. NOTE: a
  # refusal due to data-loss warnings (e.g. the Order.customerToken unique
  # constraint drift) does NOT affect the upload tables — they were created
  # by the surgical SQL above.
  echo "→ Syncing Prisma schema (db push, additive, up to 3 attempts)..."
  PUSH_OK=0
  for ATTEMPT in 1 2 3; do
    if timeout 60 bunx prisma db push --skip-generate 2>&1 | tail -6; then
      echo "  ✓ Schema in sync (attempt ${ATTEMPT})"
      PUSH_OK=1
      break
    fi
    echo "  ⚠ db push attempt ${ATTEMPT} failed (data-loss refusal or connection issue) — retrying in 15s..."
    sleep 15
  done
  if [ "$PUSH_OK" -ne 1 ]; then
    echo "  ⚠ db push skipped — the production DB has schema drift (Order.[shopId, customerToken]"
    echo "  ⚠ unique constraint). Fix separately with a DIRECT (non-pooled) DATABASE_URL:"
    echo "  ⚠   DATABASE_URL='postgresql://...@db.PROJECT.supabase.co:5432/postgres' bunx prisma db push"
    echo "  ⚠ Upload sessions already ensured via scripts/ensure-upload-tables.sql."
  fi
else
  echo "  ⚠ DATABASE_URL not set — skipping migrations"
fi

# ── 3. Build Next.js ──
echo "→ Building Next.js..."
bunx next build 2>&1 | tail -5
echo "  ✓ Next.js build complete"

echo "→ Vercel build complete."

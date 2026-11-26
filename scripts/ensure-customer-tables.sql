-- Ensure the customer-account table and the order link exist.
--
-- Why: `prisma db push` is all-or-nothing. On the production database it
-- currently refuses to run because of an unrelated schema drift (it wants
-- to add the Order.[shopId, customerToken] unique constraint, which it
-- classifies as possible data loss — see the build logs). Because of that
-- refusal, the NEW CustomerAccount table and Order.customerId column
-- never got created and the customer Google sign-in exchange would fail
-- on its first write.
--
-- This script creates exactly those, idempotently (IF NOT EXISTS),
-- touching nothing else. It is run by scripts/vercel-build.sh before
-- the db push attempt, via scripts/run-sql-file.mjs.
--
-- The SQL mirrors prisma/schema.prisma model CustomerAccount and the
-- Order.customerId field (see also
-- prisma/migrations/20261126130000_customer_accounts/migration.sql).

CREATE TABLE IF NOT EXISTS "CustomerAccount" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "phone" TEXT,
  "clerkId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_email_key" ON "CustomerAccount"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_clerkId_key" ON "CustomerAccount"("clerkId");

-- Link placed orders to the signed-in customer that placed them. NULL
-- for guest orders (the default) — guest ordering is untouched.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_customerId_idx" ON "Order"("customerId");

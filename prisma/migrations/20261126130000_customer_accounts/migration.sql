-- Customer accounts (consumer Google sign-in) + order link.
--
-- A customer account is a SEPARATE table from "User" on purpose:
-- User.email and User.clerkId are both UNIQUE and User.role is a single
-- string, so the same Google account could never be both a shopkeeper
-- and a customer in that table — and the customer flow must never link a
-- Clerk id onto an owner row. The customer exchange route only
-- reads/writes "CustomerAccount".
--
-- Named "CustomerAccount" because the schema already has a shop-scoped
-- "Customer" model (the per-shop customer directory) — unrelated to
-- sign-in.
--
-- Production apply: the Vercel build runs this DDL surgically via
-- scripts/ensure-customer-tables.sql (called from scripts/vercel-build.sh
-- before the db push attempt) — `prisma db push` alone does NOT apply it,
-- because db push is all-or-nothing and refuses on the unrelated
-- Order.[shopId, customerToken] drift. Never run `prisma migrate deploy`
-- on production (the init migration is SQLite SQL); see
-- docs/DATABASE_MIGRATION_AUDIT.md.
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

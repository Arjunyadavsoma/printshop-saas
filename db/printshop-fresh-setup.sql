-- ═══════════════════════════════════════════════════════════════════
-- PrintShop SaaS — Fresh Database Setup Script
-- ═══════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor to create a clean database.
-- It drops all existing tables first (if any) + recreates everything.
--
-- HOW TO USE:
--   1. Go to https://supabase.com/dashboard → your project → SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Wait for "Success" message
-- ═══════════════════════════════════════════════════════════════════

-- Drop all existing tables (clean slate — WARNING: deletes all data)
DROP TABLE IF EXISTS "PaymentEvent" CASCADE;
DROP TABLE IF EXISTS "PaymentAttempt" CASCADE;
DROP TABLE IF EXISTS "AuditLog" CASCADE;
DROP TABLE IF EXISTS "Subscription" CASCADE;
DROP TABLE IF EXISTS "PrintAgent" CASCADE;
DROP TABLE IF EXISTS "PrintJob" CASCADE;
DROP TABLE IF EXISTS "PrintFile" CASCADE;
DROP TABLE IF EXISTS "Order" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "Shop" CASCADE;
DROP TABLE IF EXISTS "_prisma_migrations" CASCADE;

-- Create schema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "upiId" TEXT NOT NULL,
    "paymentProvider" TEXT NOT NULL,
    "paymentCredentials" TEXT NOT NULL,
    "pricingConfig" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'free',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "description" TEXT,
    "businessHours" TEXT,
    "logoUrl" TEXT,
    "upiQrStorageKey" TEXT,
    "servicesJson" TEXT,
    "paymentPhone" TEXT,
    "paymentInstructions" TEXT,
    "cashOnPickup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "shopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_payment',
    "totalAmountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentProvider" TEXT,
    "paymentTxnId" TEXT,
    "paymentUtr" TEXT,
    "paidAt" TIMESTAMP(3),
    "customerPhone" TEXT,
    "notes" TEXT,
    "tokenNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintFile" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "colorMode" TEXT NOT NULL DEFAULT 'bw',
    "pageRange" TEXT,
    "paperSize" TEXT NOT NULL DEFAULT 'a4',
    "duplex" BOOLEAN NOT NULL DEFAULT false,
    "pricePaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "printedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintAgent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "printerName" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "version" TEXT,
    "os" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'internal',
    "providerSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "merchantOrderId" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'created',
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT,
    "merchantOrderId" TEXT,
    "providerTransactionId" TEXT,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "processingStatus" TEXT NOT NULL DEFAULT 'received',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_slug_key" ON "Shop"("slug");

-- CreateIndex
CREATE INDEX "Shop_slug_idx" ON "Shop"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_shopId_idx" ON "User"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentTxnId_key" ON "Order"("paymentTxnId");

-- CreateIndex
CREATE INDEX "Order_shopId_status_idx" ON "Order"("shopId", "status");

-- CreateIndex
CREATE INDEX "Order_customerToken_idx" ON "Order"("customerToken");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopId_tokenNumber_key" ON "Order"("shopId", "tokenNumber");

-- CreateIndex
CREATE INDEX "PrintFile_orderId_idx" ON "PrintFile"("orderId");

-- CreateIndex
CREATE INDEX "PrintJob_shopId_status_idx" ON "PrintJob"("shopId", "status");

-- CreateIndex
CREATE INDEX "PrintJob_agentId_idx" ON "PrintJob"("agentId");

-- CreateIndex
CREATE INDEX "PrintAgent_shopId_isOnline_idx" ON "PrintAgent"("shopId", "isOnline");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shopId_key" ON "Subscription"("shopId");

-- CreateIndex
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_merchantOrderId_key" ON "PaymentAttempt"("merchantOrderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_shopId_status_idx" ON "PaymentAttempt"("shopId", "status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_providerTransactionId_idx" ON "PaymentAttempt"("providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentEvent_attemptId_idx" ON "PaymentEvent"("attemptId");

-- CreateIndex
CREATE INDEX "PaymentEvent_merchantOrderId_idx" ON "PaymentEvent"("merchantOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_eventId_key" ON "PaymentEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintFile" ADD CONSTRAINT "PrintFile_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "PrintFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintAgent" ADD CONSTRAINT "PrintAgent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PrintShop — PostgreSQL-specific constraints that Prisma can't express in schema.prisma.
--
-- This file is applied AFTER the main DDL (generated by `prisma migrate diff`)
-- by:
--   - scripts/pg-migrate-prod.sh (production deploy)
--   - scripts/postgres-integration.test.ts (integration test)
--   - scripts/e2e-staging-flow.sh (via pg-migrate-prod.sh)
--
-- PRAGMA: Prisma 6.x does not support partial unique indexes in the schema
-- definition (@@unique creates a full UNIQUE constraint, not partial). This
-- file adds the database-enforced invariant that the application layer
-- cannot enforce without a race condition.
--
-- INVARIANT: at most one ACTIVE (queued or printing) PrintJob per file at
-- any time. This prevents the check-then-insert (TOCTOU) race where two
-- concurrent webhook deliveries both observe no active job and both insert.
-- The partial WHERE clause allows reprints: once a job is 'completed' or
-- 'needs_review', a new job CAN be created for the same file.
--
-- Business key analysis:
--   - An order can contain MULTIPLE files (PrintFile.orderId is a one-to-many FK).
--   - Files are NOT shared across orders (each PrintFile has exactly one orderId).
--   - A "print operation" = printing a specific file (with its settings: copies,
--     color, duplex, paperSize, pageRange).
--   - A reprint = a new PrintJob for the same file after the previous job
--     completed or went to needs_review.
--   => fileId is the correct business key for a print operation, with the
--      constraint being "at most one active job per file."

-- Drop + recreate (idempotent — safe to run multiple times).
DROP INDEX IF EXISTS "PrintJob_active_file_unique";
CREATE UNIQUE INDEX "PrintJob_active_file_unique"
  ON "PrintJob" ("fileId")
  WHERE status IN ('queued', 'printing');

-- ─────────────────────────────────────────────────────────────────────────────
-- Order tokenNumber per-shop uniqueness — race-safe allocation guard.
--
-- INVARIANT: at most one order per shop can hold a given non-null tokenNumber
-- (e.g. shop-X has exactly one "A001", one "A002", ...).
--
-- Why a PARTIAL unique index instead of a plain UNIQUE constraint:
--   - tokenNumber is nullable (legacy orders that predate token allocation,
--     or orders whose retry loop exhausted without finding a free slot).
--   - PostgreSQL's default UNIQUE constraint treats NULLs as distinct (i.e.
--     multiple NULLs are allowed) — so a plain UNIQUE constraint would also
--     work. We use a PARTIAL index here for two reasons:
--       1. It's idempotent (DROP IF EXISTS + CREATE) — safe to re-run on
--          every deploy without parsing whether the constraint already exists.
--       2. It's smaller (excludes the NULL rows from the index entirely,
--          saving space on tables with many legacy orders).
--
-- Safety check before applying:
--   If duplicate non-null tokenNumbers already exist (a real possibility if
--   the app ran before this guard was added), CREATE UNIQUE INDEX will fail
--   rather than silently corrupt. The SELECT below surfaces any pre-existing
--   duplicates so the operator can remediate (rename or NULL out the
--   duplicates) before the constraint is applied. The CREATE is wrapped in a
--   DO block so a duplicate-found condition raises a clear error instead of
--   aborting the migration mid-stream.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "Order_shop_tokenNumber_unique";
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT "shopId", "tokenNumber"
    FROM "Order"
    WHERE "tokenNumber" IS NOT NULL
    GROUP BY "shopId", "tokenNumber"
    HAVING COUNT(*) > 1
  ) AS dups;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create Order_shop_tokenNumber_unique: % non-null tokenNumber duplicates exist in the Order table. Remediate (rename or NULL out the duplicates) before re-running this migration.', dup_count
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;
CREATE UNIQUE INDEX "Order_shop_tokenNumber_unique"
  ON "Order" ("shopId", "tokenNumber")
  WHERE "tokenNumber" IS NOT NULL;

-- Seed: create a demo shop owner for testing

-- Demo shop owner (password: demo1234)
-- The password hash is PBKDF2-SHA256 (600k iterations) — generated by the app's auth system.
-- You can also register a new shopkeeper via /shop/register after the app is running.
-- To use this demo account, run the seed script instead: bun run scripts/seed.ts

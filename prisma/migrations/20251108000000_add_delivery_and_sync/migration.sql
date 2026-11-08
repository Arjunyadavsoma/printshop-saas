-- PrintShop SaaS — Add delivery + sync infrastructure tables
-- Migration: 20251108000000_add_delivery_and_sync
-- Date: 2025-11-08
--
-- Adds 4 NEW tables (additive — no changes to existing tables):
--   1. DeviceSyncState — per-device sync cursor for PrintEXE bidirectional sync
--   2. Customer — customer directory (Phase 2 business module)
--   3. PrintDeliveryAttempt — tracks each delivery attempt to a PrintEXE device
--   4. FileCleanupTask — scheduled cloud file cleanup queue
--
-- SAFETY: This migration is purely additive. No existing table is modified.
-- No existing data is affected. All new tables have shopId for tenant isolation.
-- Rollback: DROP TABLE the 4 new tables (safe — no foreign keys from existing tables).

-- ─── 1. DeviceSyncState ─────────────────────────────────────────────
-- Tracks each PrintEXE device's sync cursor for incremental pull/push.
CREATE TABLE "DeviceSyncState" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "syncCursor" TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    "lastSyncAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceSyncState_pkey" PRIMARY KEY ("id")
);

-- One sync state per device per shop
CREATE UNIQUE INDEX "DeviceSyncState_shopId_deviceId_key" ON "DeviceSyncState"("shopId", "deviceId");
CREATE INDEX "DeviceSyncState_shopId_idx" ON "DeviceSyncState"("shopId");

-- ─── 2. Customer ────────────────────────────────────────────────────
-- Customer directory — created by shopkeeper or synced from PrintEXE.
-- Supports bidirectional sync (revision + deletedAt for conflict detection).
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_shopId_updatedAt_idx" ON "Customer"("shopId", "updatedAt");
CREATE INDEX "Customer_shopId_deletedAt_idx" ON "Customer"("shopId", "deletedAt");

-- ─── 3. PrintDeliveryAttempt ────────────────────────────────────────
-- Tracks each attempt to deliver a print job's PDF to a PrintEXE device.
-- Separate from PrintJob.status (printing state) — this tracks DELIVERY state.
CREATE TABLE "PrintDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "printJobId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "attemptId" INTEGER NOT NULL DEFAULT 1,
    "deliveryMode" TEXT NOT NULL DEFAULT 'cloud',
    "status" TEXT NOT NULL DEFAULT 'created',
    "checksum" TEXT,
    "fileSize" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrintDeliveryAttempt_shopId_status_idx" ON "PrintDeliveryAttempt"("shopId", "status");
CREATE INDEX "PrintDeliveryAttempt_agentId_idx" ON "PrintDeliveryAttempt"("agentId");
CREATE INDEX "PrintDeliveryAttempt_printJobId_idx" ON "PrintDeliveryAttempt"("printJobId");

-- ─── 4. FileCleanupTask ─────────────────────────────────────────────
-- Scheduled cloud file cleanup queue. Created after verified receipt.
-- Processed by the cron endpoint (/api/v1/cron/cleanup).
CREATE TABLE "FileCleanupTask" (
    "id" TEXT NOT NULL,
    "printFileId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "cleanupType" TEXT NOT NULL DEFAULT 'after_receipt',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileCleanupTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileCleanupTask_shopId_status_idx" ON "FileCleanupTask"("shopId", "status");
CREATE INDEX "FileCleanupTask_scheduledAt_idx" ON "FileCleanupTask"("scheduledAt");
CREATE INDEX "FileCleanupTask_printFileId_idx" ON "FileCleanupTask"("printFileId");

-- ─── Add accent column to PaymentEvent (typo fix from original migration) ───
-- The original init migration had a typo: @@index(erchantOrderId]) instead of @@index([merchantOrderId])
-- This is a no-op if the index already exists correctly.
-- Skipped — not worth the risk of modifying an existing table.

-- ─── Migration complete ───
-- Verify: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- Should show 14 tables (10 existing + 4 new).

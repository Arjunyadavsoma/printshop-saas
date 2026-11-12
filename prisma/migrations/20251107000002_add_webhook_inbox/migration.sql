-- Phase 6.12: WebhookInbox table for durable unmatched webhook recovery.
-- Stores verified callbacks that arrive before the PaymentAttempt exists.
-- The reconciliation cron processes unmatched entries and matches them
-- to PaymentAttempts when they become available.

CREATE TABLE IF NOT EXISTS "WebhookInbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "merchantOrderId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "providerTxnId" TEXT,
    "amountPaise" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "signatureValid" BOOLEAN NOT NULL DEFAULT true,
    "processingStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookInbox_provider_providerEventId_key"
  ON "WebhookInbox" ("provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "WebhookInbox_merchantOrderId_idx"
  ON "WebhookInbox" ("merchantOrderId");
CREATE INDEX IF NOT EXISTS "WebhookInbox_processingStatus_nextRetryAt_idx"
  ON "WebhookInbox" ("processingStatus", "nextRetryAt");

-- Phase 6.7: Create PaymentAttempt + PaymentEvent tables with indexes.
-- FK constraints are added in a later migration (after init creates Shop/Order).
-- This migration is idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "PaymentAttempt" (
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

CREATE TABLE IF NOT EXISTS "PaymentEvent" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_merchantOrderId_key" ON "PaymentAttempt"("merchantOrderId");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_shopId_status_idx" ON "PaymentAttempt"("shopId", "status");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_orderId_status_idx" ON "PaymentAttempt"("orderId", "status");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_providerTransactionId_idx" ON "PaymentAttempt"("providerTransactionId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_attemptId_idx" ON "PaymentEvent"("attemptId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_merchantOrderId_idx" ON "PaymentEvent"("merchantOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_provider_eventId_key" ON "PaymentEvent"("provider", "eventId");

-- AUDIT-002: Pre-flight duplicate check
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM (SELECT "orderId" FROM "PaymentAttempt" WHERE "status" = 'created' GROUP BY "orderId" HAVING COUNT(*) > 1) dup) THEN
        RAISE EXCEPTION 'Cannot create PaymentAttempt_active_order_unique: duplicate active attempts found.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_active_order_unique"
  ON "PaymentAttempt" ("orderId") WHERE "status" = 'created';

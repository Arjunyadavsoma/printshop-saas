-- Phase 4: Customer accounts.
-- Adds the CustomerAccount table + Order.customerAccountId nullable FK.
-- Additive — existing guest orders keep working unchanged.

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'CustomerAccount'
    ) THEN
        CREATE TABLE "CustomerAccount" (
            "id"            TEXT NOT NULL,
            "email"         TEXT NOT NULL,
            "passwordHash"  TEXT NOT NULL,
            "name"          TEXT NOT NULL,
            "phone"         TEXT,
            "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
            "emailVerified" BOOLEAN NOT NULL DEFAULT false,
            "deactivatedAt" TIMESTAMP(3),
            "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt"     TIMESTAMP(3) NOT NULL,
            CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
        );
        CREATE UNIQUE INDEX "CustomerAccount_email_key" ON "CustomerAccount"("email");
        CREATE INDEX "CustomerAccount_email_idx" ON "CustomerAccount"("email");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Order' AND column_name = 'customerAccountId'
    ) THEN
        ALTER TABLE "Order" ADD COLUMN "customerAccountId" TEXT;
        CREATE INDEX "Order_customerAccountId_idx" ON "Order"("customerAccountId");
    END IF;
END $$;

-- Optional FK: only add if CustomerAccount exists (the prior block
-- guarantees it). Idempotent on the constraint name.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Order_customerAccountId_fkey'
    ) THEN
        ALTER TABLE "Order"
            ADD CONSTRAINT "Order_customerAccountId_fkey"
            FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Ensure refund + payment-idempotency tables/indexes exist (idempotent).
-- Run by scripts/vercel-build.sh because prisma migrate deploy / db push may
-- be blocked by the pre-existing Order.[shopId, customerToken] drift. This
-- script is safe to run on every deploy — every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "Refund" (
    "id"                 TEXT NOT NULL,
    "orderId"            TEXT NOT NULL,
    "paymentId"          TEXT,
    "paymentAttemptId"   TEXT,
    "provider"           TEXT NOT NULL,
    "providerRefundId"   TEXT,
    "amountPaise"        INTEGER NOT NULL,
    "reason"             TEXT NOT NULL DEFAULT 'Customer request',
    "status"             TEXT NOT NULL DEFAULT 'pending',
    "initiatedBy"        TEXT NOT NULL,
    "initiatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"        TIMESTAMP(3),
    "errorMessage"       TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Refund_orderId_fkey') THEN
        ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_provider_providerRefundId_key"
    ON "Refund" ("provider", "providerRefundId")
    WHERE "providerRefundId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Refund_orderId_idx" ON "Refund" ("orderId");
CREATE INDEX IF NOT EXISTS "Refund_status_idx" ON "Refund" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_utr_unique"
    ON "Payment" ("utr") WHERE "utr" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_active_order_method_unique"
    ON "Payment" ("orderId", "method") WHERE "status" IN ('SUBMITTED', 'PENDING');

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_providerTransactionId_unique"
    ON "PaymentAttempt" ("providerTransactionId") WHERE "providerTransactionId" IS NOT NULL;

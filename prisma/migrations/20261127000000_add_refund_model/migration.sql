-- Refund model + payment idempotency hardening (Feature 4 — Checkout & Payments)
-- Additive only: new table + new partial unique indexes. No existing column
-- is dropped or type-changed. Safe to run multiple times (IF NOT EXISTS).

-- 1. Refund table -----------------------------------------------------------
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

-- FK to Order (RESTRICT — a refund row must not be orphaned by order deletion).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Refund_orderId_fkey') THEN
        ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- One refund per PSP reference (the replay guard). providerRefundId is
-- nullable until the PSP confirms — partial unique on non-null values.
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_provider_providerRefundId_key"
    ON "Refund" ("provider", "providerRefundId")
    WHERE "providerRefundId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Refund_orderId_idx" ON "Refund" ("orderId");
CREATE INDEX IF NOT EXISTS "Refund_status_idx" ON "Refund" ("status");

-- 2. Payment idempotency hardening -----------------------------------------
-- W3: partial unique on Payment.utr (non-null) — prevents the same UTR being
--     linked to two different orders. The application-layer duplicate scan in
--     submitPayment is the first line of defense; this DB constraint is the
--     race-safe backstop (two concurrent submissions can't both win).
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_utr_unique"
    ON "Payment" ("utr")
    WHERE "utr" IS NOT NULL;

-- W1: partial unique on Payment(orderId, method) for ACTIVE statuses only —
--     prevents a double-tap "submit UTR" from creating two SUBMITTED rows for
--     the same order+method. REJECTED/CONFIRMED rows are excluded so a
--     customer can re-submit after a rejection.
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_active_order_method_unique"
    ON "Payment" ("orderId", "method")
    WHERE "status" IN ('SUBMITTED', 'PENDING');

-- 3. PaymentAttempt.providerTransactionId partial unique (W11) -------------
-- Two attempts should never share the same PSP transaction id. Nullable, so
-- partial unique on non-null values only.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_providerTransactionId_unique"
    ON "PaymentAttempt" ("providerTransactionId")
    WHERE "providerTransactionId" IS NOT NULL;

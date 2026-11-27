-- Gmail connection + payment evidence models (Phase E + F)
-- Additive only: new tables. No existing column dropped or changed.

CREATE TABLE IF NOT EXISTS "ShopGmailConnection" (
    "id"                    TEXT NOT NULL,
    "shopId"                TEXT NOT NULL,
    "googleEmail"           TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "grantedScopes"         TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'active',
    "lastSyncAt"            TIMESTAMP(3),
    "historyCursor"         TEXT,
    "watchExpiration"       TIMESTAMP(3),
    "syncError"             TEXT,
    "matchedCount"          INTEGER NOT NULL DEFAULT 0,
    "pendingReviewCount"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopGmailConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopGmailConnection_shopId_key" ON "ShopGmailConnection" ("shopId");
CREATE INDEX IF NOT EXISTS "ShopGmailConnection_status_idx" ON "ShopGmailConnection" ("status");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShopGmailConnection_shopId_fkey') THEN
        ALTER TABLE "ShopGmailConnection" ADD CONSTRAINT "ShopGmailConnection_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentEvidence" (
    "id"                    TEXT NOT NULL,
    "shopId"                TEXT NOT NULL,
    "sourceType"            TEXT NOT NULL,
    "externalId"            TEXT,
    "transactionRef"        TEXT,
    "amountPaise"           INTEGER NOT NULL,
    "currency"              TEXT NOT NULL DEFAULT 'INR',
    "receivingUpiId"        TEXT,
    "senderAddress"         TEXT,
    "evidenceTimestamp"     TIMESTAMP(3) NOT NULL,
    "authenticationResult"  TEXT,
    "processingStatus"      TEXT NOT NULL DEFAULT 'pending',
    "matchedOrderId"        TEXT,
    "redactedMetadata"      JSONB,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvidence_sourceType_externalId_key"
    ON "PaymentEvidence" ("sourceType", "externalId") WHERE "externalId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvidence_transactionRef_key"
    ON "PaymentEvidence" ("transactionRef") WHERE "transactionRef" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "PaymentEvidence_shopId_processingStatus_idx" ON "PaymentEvidence" ("shopId", "processingStatus");
CREATE INDEX IF NOT EXISTS "PaymentEvidence_matchedOrderId_idx" ON "PaymentEvidence" ("matchedOrderId");
CREATE INDEX IF NOT EXISTS "PaymentEvidence_amountPaise_idx" ON "PaymentEvidence" ("amountPaise");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentEvidence_shopId_fkey') THEN
        ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

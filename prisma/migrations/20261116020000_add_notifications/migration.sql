-- Phase 5: Durable notification outbox.
-- Additive — no existing tables touched.

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'Notification'
    ) THEN
        CREATE TABLE "Notification" (
            "id"             TEXT NOT NULL,
            "shopId"         TEXT,
            "recipientId"    TEXT,
            "recipientEmail" TEXT,
            "recipientPhone" TEXT,
            "channel"        TEXT NOT NULL,
            "eventType"      TEXT NOT NULL,
            "entityId"       TEXT,
            "subject"        TEXT,
            "body"           TEXT NOT NULL,
            "payload"        TEXT,
            "dedupKey"       TEXT,
            "status"         TEXT NOT NULL DEFAULT 'pending',
            "attempts"       INTEGER NOT NULL DEFAULT 0,
            "maxAttempts"    INTEGER NOT NULL DEFAULT 5,
            "nextAttemptAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "lastError"      TEXT,
            "sentAt"         TIMESTAMP(3),
            "readAt"         TIMESTAMP(3),
            "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt"      TIMESTAMP(3) NOT NULL,
            CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
        );
        CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey");
        CREATE INDEX "Notification_shopId_status_idx" ON "Notification"("shopId", "status");
        CREATE INDEX "Notification_recipientId_status_idx" ON "Notification"("recipientId", "status");
        CREATE INDEX "Notification_nextAttemptAt_idx" ON "Notification"("nextAttemptAt");
        CREATE INDEX "Notification_eventType_idx" ON "Notification"("eventType");
    END IF;
END $$;

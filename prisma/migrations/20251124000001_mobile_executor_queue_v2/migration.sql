-- Mobile executor / queue v2 schema additions.
-- All columns have safe defaults; old PrintEXE builds are unaffected.

-- PrintAgent: mobile executor fields
ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'PC';
ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "appVersion" TEXT;
ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "capabilities" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "agentName" TEXT;
CREATE INDEX IF NOT EXISTS "PrintAgent_shopId_kind_idx" ON "PrintAgent"("shopId", "kind");

-- PrintJob: queue v2 fields
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "position" TEXT NOT NULL DEFAULT 'a0';
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "isHeld" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "executorMode" TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "claimedByAgentId" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "claimLeaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PrintJob" ADD COLUMN IF NOT EXISTS "lastExecutorKind" TEXT;
CREATE INDEX IF NOT EXISTS "PrintJob_shopId_isHeld_priority_position_idx" ON "PrintJob"("shopId", "isHeld", "priority", "position");
CREATE INDEX IF NOT EXISTS "PrintJob_claimedByAgentId_idx" ON "PrintJob"("claimedByAgentId");

-- Printer: UUID for merging
ALTER TABLE "Printer" ADD COLUMN IF NOT EXISTS "printerUuid" TEXT;
CREATE INDEX IF NOT EXISTS "Printer_printerUuid_idx" ON "Printer"("printerUuid");

-- New table: PrinterPath
CREATE TABLE IF NOT EXISTS "PrinterPath" (
    "id"           TEXT NOT NULL,
    "printerId"    TEXT NOT NULL,
    "agentId"      TEXT NOT NULL,
    "kind"         TEXT NOT NULL,
    "uri"          TEXT NOT NULL,
    "lastSeenAt"   TIMESTAMP(3),
    "status"       TEXT NOT NULL DEFAULT 'unknown',
    "capabilities" TEXT NOT NULL DEFAULT '{}',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrinterPath_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PrinterPath_printerId_agentId_kind_key"
    ON "PrinterPath"("printerId", "agentId", "kind");
CREATE INDEX IF NOT EXISTS "PrinterPath_printerId_idx" ON "PrinterPath"("printerId");
CREATE INDEX IF NOT EXISTS "PrinterPath_agentId_idx" ON "PrinterPath"("agentId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrinterPath_printerId_fkey') THEN
        ALTER TABLE "PrinterPath"
            ADD CONSTRAINT "PrinterPath_printerId_fkey"
            FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrinterPath_agentId_fkey') THEN
        ALTER TABLE "PrinterPath"
            ADD CONSTRAINT "PrinterPath_agentId_fkey"
            FOREIGN KEY ("agentId") REFERENCES "PrintAgent" ("id") ON DELETE CASCADE;
    END IF;
END $$;

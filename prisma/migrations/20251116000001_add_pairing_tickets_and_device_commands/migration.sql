-- Add PairingTicket, DeviceCommand models and PrintAgent.isEnabled field.
--
-- PairingTicket: single-use, short-lived tickets for PrintEXE companion
--   pairing. Created by shopkeeper, consumed once by the companion to
--   exchange for a device token. Only SHA-256 hash stored.
--
-- DeviceCommand: remote commands from website to companion devices.
--   Persisted before delivery, validated against an allowlist, tracked
--   through full lifecycle (requested→delivered→executed→succeeded/failed).
--
-- PrintAgent.isEnabled: allows disabling a device without deleting it
--   (suspension vs revocation).
--
-- All changes are additive — no columns or tables are removed.

ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "isEnabled" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "PrintAgent_shopId_isEnabled_idx" ON "PrintAgent"("shopId", "isEnabled");

CREATE TABLE IF NOT EXISTS "PairingTicket" (
  "id"              TEXT NOT NULL,
  "shopId"          TEXT NOT NULL,
  "agentId"         TEXT,
  "createdByUserId" TEXT NOT NULL,
  "ticketHash"      TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'active',
  "expiresAt"       TIMESTAMP NOT NULL,
  "consumedAt"      TIMESTAMP,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deviceName"      TEXT,
  "deviceMetadata"  TEXT,
  CONSTRAINT "PairingTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PairingTicket_ticketHash_key" ON "PairingTicket"("ticketHash");
CREATE INDEX IF NOT EXISTS "PairingTicket_shopId_status_idx" ON "PairingTicket"("shopId", "status");
CREATE INDEX IF NOT EXISTS "PairingTicket_expiresAt_idx" ON "PairingTicket"("expiresAt");
ALTER TABLE "PairingTicket" ADD CONSTRAINT "PairingTicket_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE;
ALTER TABLE "PairingTicket" ADD CONSTRAINT "PairingTicket_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "PrintAgent"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "DeviceCommand" (
  "id"              TEXT NOT NULL,
  "shopId"          TEXT NOT NULL,
  "agentId"         TEXT NOT NULL,
  "commandType"     TEXT NOT NULL,
  "payload"         TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'requested',
  "initiatedBy"     TEXT NOT NULL,
  "result"          TEXT,
  "idempotencyKey"  TEXT NOT NULL,
  "expiresAt"       TIMESTAMP NOT NULL,
  "deliveredAt"     TIMESTAMP,
  "executedAt"      TIMESTAMP,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceCommand_idempotencyKey_key" ON "DeviceCommand"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "DeviceCommand_shopId_agentId_status_idx" ON "DeviceCommand"("shopId", "agentId", "status");
CREATE INDEX IF NOT EXISTS "DeviceCommand_agentId_status_idx" ON "DeviceCommand"("agentId", "status");
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE;
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "PrintAgent"("id") ON DELETE CASCADE;

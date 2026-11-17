-- Align PairingTicket/DeviceCommand columns and FK referential actions.
--
-- Discovered by Phase B verification (2026-11-17): `prisma migrate diff`
-- between a fresh `prisma migrate deploy` database and schema.prisma showed
-- two kinds of drift introduced by migration 20251116000001:
--   1. plain TIMESTAMP columns + a DB-side updatedAt default where the
--      schema declares TIMESTAMP(3) with no default;
--   2. five FK constraints created with ON DELETE CASCADE where the schema
--      declares RESTRICT (PairingTicket.shopId, DeviceCommand.shopId,
--      DeviceCommand.agentId, PasswordResetToken.userId) and SET NULL
--      (PairingTicket.agentId — optional column).
-- Production (manually applied) shares both drifts.
--
-- Idempotent: SET DATA TYPE to the same type is a metadata-only no-op;
-- the FK statements are DROP CONSTRAINT IF EXISTS + ADD, so re-running
-- converges to the same state.
--
-- PRODUCTION PRE-FLIGHT (run before applying against real data — the FKs
-- are added in validated mode, so orphan rows would fail the migration):
--   SELECT count(*) FROM "PairingTicket" t LEFT JOIN "PrintAgent" a ON a.id = t."agentId"
--     WHERE t."agentId" IS NOT NULL AND a.id IS NULL;           -- must be 0
--   SELECT count(*) FROM "PairingTicket" t LEFT JOIN "Shop" s ON s.id = t."shopId"
--     WHERE s.id IS NULL;                                        -- must be 0
--   SELECT count(*) FROM "DeviceCommand" c LEFT JOIN "PrintAgent" a ON a.id = c."agentId"
--     WHERE a.id IS NULL;                                        -- must be 0
--   SELECT count(*) FROM "DeviceCommand" c LEFT JOIN "Shop" s ON s.id = c."shopId"
--     WHERE s.id IS NULL;                                        -- must be 0
--   SELECT count(*) FROM "PasswordResetToken" t LEFT JOIN "User" u ON u.id = t."userId"
--     WHERE u.id IS NULL;                                        -- must be 0

-- Column alignment (schema.prisma: TIMESTAMP(3), updatedAt has no DB default)
ALTER TABLE "DeviceCommand" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "deliveredAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "executedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DeviceCommand" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "PairingTicket" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "PairingTicket" ALTER COLUMN "consumedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "PairingTicket" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- Missing / mismatched foreign keys.
--
-- Migration 20251116000001 created these five FKs with ON DELETE CASCADE,
-- but schema.prisma declares RESTRICT (PairingTicket.shopId,
-- DeviceCommand.shopId, DeviceCommand.agentId, PasswordResetToken.userId)
-- and SET NULL (PairingTicket.agentId — the column is optional). The
-- actions are force-aligned with the schema here: DROP IF EXISTS + ADD,
-- which is idempotent (re-running the migration converges to the same
-- state). RESTRICT on DeviceCommand.agentId is only safe because the
-- device-revocation routes now delete the agent's commands BEFORE deleting
-- the agent row (same change set).
--
-- PRODUCTION PRE-FLIGHT (validated-mode ADD will fail on orphans):
--   SELECT count(*) FROM "PairingTicket" t LEFT JOIN "PrintAgent" a ON a.id = t."agentId"
--     WHERE t."agentId" IS NOT NULL AND a.id IS NULL;           -- must be 0
--   SELECT count(*) FROM "DeviceCommand" c LEFT JOIN "PrintAgent" a ON a.id = c."agentId"
--     WHERE a.id IS NULL;                                        -- must be 0
--   SELECT count(*) FROM "DeviceCommand" c LEFT JOIN "Shop" s ON s.id = c."shopId"
--     WHERE s.id IS NULL;                                        -- must be 0

-- Column alignment (schema.prisma: TIMESTAMP(3), updatedAt has no DB default)
ALTER TABLE "DeviceCommand" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "deliveredAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "executedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "DeviceCommand" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DeviceCommand" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "PairingTicket" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "PairingTicket" ALTER COLUMN "consumedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "PairingTicket" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "PasswordResetToken" DROP CONSTRAINT IF EXISTS "PasswordResetToken_userId_fkey";
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PairingTicket" DROP CONSTRAINT IF EXISTS "PairingTicket_shopId_fkey";
ALTER TABLE "PairingTicket" ADD CONSTRAINT "PairingTicket_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PairingTicket" DROP CONSTRAINT IF EXISTS "PairingTicket_agentId_fkey";
ALTER TABLE "PairingTicket" ADD CONSTRAINT "PairingTicket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "PrintAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceCommand" DROP CONSTRAINT IF EXISTS "DeviceCommand_shopId_fkey";
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceCommand" DROP CONSTRAINT IF EXISTS "DeviceCommand_agentId_fkey";
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "PrintAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

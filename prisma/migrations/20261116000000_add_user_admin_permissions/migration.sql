-- Phase 1: Add adminPermissions column to User.
-- Additive + nullable so existing rows + released clients keep working.
-- Stored as text (JSON-encoded array of AdminPermission values).
-- Idempotent: IF NOT EXISTS guards repeated `migrate deploy` runs.

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'User' AND column_name = 'adminPermissions'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "adminPermissions" TEXT;
    END IF;
END $$;

-- Token rotation support for PrintAgent (device credentials).
-- Adds the previous-credential hash + rotation timestamp. The previous
-- token is honoured by withDeviceAuth for a 10-minute grace window, then
-- rejected — replayed old credentials stop working without a deploy.
--
-- Idempotent: safe to re-run against environments where the columns were
-- applied manually (matching the repo convention of 20251116000001).

ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "prevTokenHash" TEXT;
ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "tokenRotatedAt" TIMESTAMP(3);

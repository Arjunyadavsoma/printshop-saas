-- Phase 4 (B-010): server-side SHA-256 of the stored file bytes.
-- Computed at confirm time when the storage adapter exposes getBytes;
-- delivered to the companion in the agent pending-jobs payload (pdfSha256)
-- for pre-print content verification; the receipt path audits the agent's
-- checksum against it (trust-on-first-use when null). Nullable — rows from
-- before this migration simply have no server-side hash.
ALTER TABLE "PrintFile" ADD COLUMN "sha256" TEXT;

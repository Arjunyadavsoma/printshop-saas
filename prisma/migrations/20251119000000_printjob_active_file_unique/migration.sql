-- Phase 5: promote the hand-applied partial unique index into the migration
-- chain so a fresh `prisma migrate deploy` produces the SAME invariants as
-- the production database maintained via scripts/pg-migrate-prod.sh.
--
-- INVARIANT: at most one ACTIVE (queued|printing) PrintJob per file — the
-- TOCTOU guard for job creation. A reprint is a new job for the same file
-- after the previous one completed or went to needs_review.
--
-- Idempotent: IF NOT EXISTS makes re-application safe.

CREATE UNIQUE INDEX IF NOT EXISTS "PrintJob_active_file_unique"
  ON "PrintJob" ("fileId")
  WHERE status IN ('queued', 'printing');

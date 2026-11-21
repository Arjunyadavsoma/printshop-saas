-- Product build Phase 1 (docs/DATA-MODEL.md): PrintTask model.
-- The legacy invariant "at most one ACTIVE PrintJob per file" existed to
-- guard the 1:1 file->job creation flow (TOCTOU guard, 20251119000000).
-- The product build splits ONE file into MULTIPLE concurrent tasks
-- (COLOR_SET -> color printer, BW_SET -> B&W printer), so the invariant is
-- retired. Creation-order dedup is now guaranteed by
-- PrintJob.idempotencyKey @unique (planner emits
-- {orderId}:{fileId}:{kind}:{attempt}).
DROP INDEX IF EXISTS "PrintJob_active_file_unique";

-- Add pageCountSource and processingError to PrintFile.
--
-- pageCountSource tracks the origin and trust level of the page count:
--   auto_extracted       — parser confidently extracted the count (PDF, DOCX, etc.)
--   customer_declared    — customer entered the count manually
--   shopkeeper_confirmed — shopkeeper verified or set the count
--   placeholder          — no trustworthy count available; file needs review
--
-- Existing rows default to 'placeholder' since their counts predate the
-- source-tracking system and cannot be assumed verified.
--
-- processingError stores the reason when page-count extraction fails (e.g.
-- "corrupted PDF", "encrypted document"), so the UI can show a meaningful
-- explanation instead of a generic "needs review".
--
-- This migration is purely additive — no columns are removed or renamed.

ALTER TABLE "PrintFile" ADD COLUMN "pageCountSource" TEXT NOT NULL DEFAULT 'placeholder';
ALTER TABLE "PrintFile" ADD COLUMN "processingError" TEXT;

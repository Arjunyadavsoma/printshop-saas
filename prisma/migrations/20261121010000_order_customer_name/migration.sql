-- Product build Phase 1: the brief's customer flow shows a customer NAME on
-- the order; the legacy flow only stored the phone. Additive, nullable.
ALTER TABLE "Order" ADD COLUMN "customerName" TEXT;

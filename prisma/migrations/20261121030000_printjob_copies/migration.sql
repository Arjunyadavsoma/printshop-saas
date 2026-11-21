-- Product build Phase 4: PrintTask carries its own copies (the planner's
-- spec.copies lands on every task; agent prints copies copies of the set).
ALTER TABLE "PrintJob" ADD COLUMN "copies" INTEGER;

-- Phase 6.4: Partial unique index ensuring at most one 'created' (active)
-- PaymentAttempt per order. This is the database-level enforcement of the
-- checkout idempotency invariant — application-level checks alone cannot
-- prevent race conditions under concurrent access.
--
-- The index allows multiple attempts per order (for retry after expiry),
-- but only ONE with status='created' at any time. When an attempt expires
-- (status changes to 'expired'), a new 'created' attempt can be inserted.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_active_order_unique"
  ON "PaymentAttempt" ("orderId")
  WHERE "status" = 'created';

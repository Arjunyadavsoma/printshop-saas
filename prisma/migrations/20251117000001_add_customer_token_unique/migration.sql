-- H9 fix: add a UNIQUE constraint on (shopId, customerToken) to the "Order" table.
--
-- customerToken is the per-order "credential" that customers present (via the
-- X-Order-Token header or ?t= query param) to access their own order status,
-- receipt, and file downloads. Without a UNIQUE constraint, two orders in the
-- same shop could be issued the same 6-char token (the generator is a random
-- 6-char uppercase string), which would silently let one customer see
-- another's order via withOrderAccess (constant-time-compares the token and
-- grants access on match).
--
-- The index already existed as a non-unique @@index([customerToken]) for the
-- shopkeeper's token-search UX; this migration adds the composite UNIQUE
-- index on (shopId, customerToken) so collisions are rejected at INSERT time.
-- The repo's createWithUniqueToken retry loop is the application-layer guard;
-- this constraint is the durable DB-level backstop.
--
-- IF NOT EXISTS guards re-running the migration on databases where the index
-- was already added (e.g. via `prisma db push` during dev).

CREATE UNIQUE INDEX IF NOT EXISTS "Order_shopId_customerToken_key"
  ON "Order"("shopId", "customerToken");

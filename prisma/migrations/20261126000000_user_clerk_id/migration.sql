-- Link local users to Clerk sign-in accounts.
-- Adds the nullable clerkId column (Clerk user id, `user_…`) with a UNIQUE
-- index. Nullable + unique: many password-only accounts can stay null,
-- but each Clerk id maps to exactly one local user.
--
-- Production apply: the Vercel build runs `prisma db push` (additive),
-- which adds this column automatically — no manual step. Never run
-- `prisma migrate deploy` on production (the init migration is SQLite
-- SQL); see docs/DATABASE_MIGRATION_AUDIT.md.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clerkId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_clerkId_key" ON "User"("clerkId");

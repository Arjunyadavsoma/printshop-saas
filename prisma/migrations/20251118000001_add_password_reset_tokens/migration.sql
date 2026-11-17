-- H16 fix: add the PasswordResetToken table for the forgot-password flow.
--
-- The "User" model previously had no password-reset capability — there was
-- no /api/v1/auth/forgot-password, no /api/v1/auth/reset-password, and no
-- /api/v1/me/password. This migration adds the durable store for single-use
-- reset tokens. The plaintext token is NEVER persisted — only its SHA-256
-- hash. The plaintext is sent to the user via email (or captured to memory
-- by the StubEmailAdapter in dev).
--
-- Lifecycle:
--   1. POST /api/v1/auth/forgot-password { email }
--      → look up user (silently succeed if not found — no account enumeration)
--      → generate a 32-byte URL-safe random token
--      → store SHA-256(token) here with expiresAt = now + 15min
--      → email the user a link with ?token=<plaintext>
--   2. POST /api/v1/auth/reset-password { token, newPassword }
--      → hash the submitted token, look up the row by tokenHash
--      → check expiresAt > now AND usedAt IS NULL
--      → hash newPassword (PBKDF2-SHA256, 600k iterations)
--      → UPDATE User.passwordHash
--      → mark this row usedAt = now (single-use)
--      → write auth.password.reset audit log
--   3. POST /api/v1/me/password { oldPassword, newPassword } (authenticated)
--      → verify oldPassword against User.passwordHash
--      → hash newPassword, UPDATE User.passwordHash
--      → write auth.password.change audit log
--
-- The "user" relation is optional on the FK to avoid locking migrations
-- behind an existing User table; the @@index([userId]) supports the
-- "list active tokens for this user" query if we ever add a UI for it.

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on tokenHash — a token hash collides only if the
-- underlying 32-byte random token collides, which is vanishingly unlikely,
-- but the UNIQUE index is the durable guarantee that a reused hash (e.g.
-- from a buggy generator) is rejected at INSERT time rather than silently
-- creating two valid reset rows for the same token.
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key"
    ON "PasswordResetToken" ("tokenHash");

-- Foreign key to "User". ON DELETE CASCADE so a deleted user's reset tokens
-- disappear with them (no orphan rows pointing at a missing userId).
-- IF NOT EXISTS guard via DO block — Prisma's `migrate deploy` replays every
-- migration on a fresh DB, and a bare `ADD CONSTRAINT` is not idempotent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_userId_fkey'
    ) THEN
        ALTER TABLE "PasswordResetToken"
            ADD CONSTRAINT "PasswordResetToken_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User" ("id")
            ON DELETE CASCADE;
    END IF;
END$$;

-- Lookup indexes — the hot paths are:
--   - SELECT ... WHERE tokenHash = $1   (reset-password verify)  → covered by the UNIQUE index above
--   - SELECT ... WHERE userId = $1     (admin "list active tokens for user")
--   - SELECT ... WHERE expiresAt < $1  (cron cleanup of expired tokens)
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx"
    ON "PasswordResetToken" ("userId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx"
    ON "PasswordResetToken" ("expiresAt");

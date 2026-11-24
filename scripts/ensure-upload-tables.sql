-- Ensure the DB-backed upload-session registry tables exist.
--
-- Why: `prisma db push` is all-or-nothing. On the production database it
-- currently refuses to run because of an unrelated schema drift (it wants
-- to add the Order.[shopId, customerToken] unique constraint, which it
-- classifies as possible data loss — see the build logs). Because of that
-- refusal, the NEW UploadSession/UploadChunk tables never got created and
-- production uploads kept using the in-process fallback.
--
-- This script creates exactly those two tables, idempotently (IF NOT
-- EXISTS), touching nothing else. It is run by scripts/vercel-build.sh
-- before the db push attempt, via `prisma db execute`.
--
-- The SQL mirrors prisma/schema.prisma models UploadSession + UploadChunk.

CREATE TABLE IF NOT EXISTS "UploadSession" (
    "uploadId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "orderToken" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChunkAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("uploadId")
);

CREATE INDEX IF NOT EXISTS "UploadSession_lastChunkAt_idx" ON "UploadSession"("lastChunkAt");
CREATE INDEX IF NOT EXISTS "UploadSession_createdAt_idx" ON "UploadSession"("createdAt");

CREATE TABLE IF NOT EXISTS "UploadChunk" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UploadChunk_uploadId_idx_key" ON "UploadChunk"("uploadId", "idx");
CREATE INDEX IF NOT EXISTS "UploadChunk_uploadId_idx" ON "UploadChunk"("uploadId");

-- FK with cascade delete (safe: the table is brand new / empty).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UploadChunk_uploadId_fkey'
    ) THEN
        ALTER TABLE "UploadChunk"
            ADD CONSTRAINT "UploadChunk_uploadId_fkey"
            FOREIGN KEY ("uploadId") REFERENCES "UploadSession"("uploadId")
            ON DELETE CASCADE;
    END IF;
END $$;

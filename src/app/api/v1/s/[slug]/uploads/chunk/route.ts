import { NextRequest } from 'next/server';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { appendChunk, getSession, abandonSession, MAX_FILE_BYTES } from '@/lib/pipeline/upload-sessions';
import { AppError, NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * PUT /api/v1/s/[slug]/uploads/chunk?uploadId=…&index=N&checksum=<sha256hex>
 *
 * Append (or re-upload idempotently) one chunk of a resumable upload. The
 * body is raw bytes (not multipart). The client computes the SHA-256 of the
 * chunk body + sends it as `?checksum=`; the server verifies before writing.
 *
 * Idempotency: re-uploading the SAME `index` with the SAME `checksum` is a
 * no-op (returns `{ duplicated: true }`). Re-uploading the same `index`
 * with a DIFFERENT `checksum` throws `CHUNK_CONFLICT` — the client must
 * restart the session (the bytes on disk don't match what the client thinks
 * it sent).
 *
 * The client tracks its own offset via `GET /status?uploadId=…` and skips
 * already-received chunks on resume.
 */
export const PUT = withRateLimit('uploads-chunk', 600, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    await ctx.params;
    const uploadId = req.nextUrl.searchParams.get('uploadId') ?? '';
    const indexStr = req.nextUrl.searchParams.get('index') ?? '';
    const checksum = req.nextUrl.searchParams.get('checksum') ?? '';

    const session = getSession(uploadId);
    if (!session) throw new NotFoundError('Upload session not found or expired — restart the upload.');
    if (session.status !== 'active') {
      throw new NotFoundError('Upload session has expired — restart the upload.');
    }

    // Validate the chunk index (must be a non-negative integer).
    const chunkIndex = Number.parseInt(indexStr, 10);
    if (!Number.isFinite(chunkIndex) || chunkIndex < 0) {
      throw new ValidationError('Missing or invalid chunk index (use ?index=N).');
    }
    if (!/^[a-f0-9]{64}$/i.test(checksum)) {
      throw new ValidationError('Missing or invalid chunk checksum (use ?checksum=<sha256hex>).');
    }

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) throw new ValidationError('Empty chunk.');

    const result = await appendChunk(uploadId, chunkIndex, bytes, checksum);
    return ok({
      receivedBytes: result.receivedBytes,
      chunkIndex: result.chunkIndex,
      duplicated: result.duplicated,
      maxBytes: MAX_FILE_BYTES,
    });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg === 'FILE_TOO_LARGE') {
      return fail(new AppError('File is larger than the 50 MB limit — upload was stopped.', 'FILE_TOO_LARGE', 413));
    }
    if (msg === 'CHECKSUM_MISMATCH') {
      return fail(new AppError('Chunk checksum mismatch — the bytes were corrupted in transit. Retry this chunk.', 'CHECKSUM_MISMATCH', 400));
    }
    if (msg === 'CHUNK_CONFLICT') {
      return fail(new AppError('Chunk conflict — this index was already received with different bytes. Restart the upload.', 'CHUNK_CONFLICT', 409));
    }
    if (msg === 'UPLOAD_EXPIRED') {
      return fail(new AppError('Upload session has expired — restart the upload.', 'UPLOAD_EXPIRED', 410));
    }
    return fail(toAppError(cause));
  }
});

/**
 * DELETE /api/v1/s/[slug]/uploads/chunk?uploadId=…
 *
 * Customer cancelled mid-upload — abandon the session + delete the partial
 * chunk files from disk. Idempotent: a missing session returns 200
 * `{ cancelled: true }` (the customer's intent is satisfied either way).
 */
export const DELETE = withRateLimit('uploads-chunk', 60, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    await ctx.params;
    const uploadId = req.nextUrl.searchParams.get('uploadId') ?? '';
    // abandonSession is a no-op if the session doesn't exist — the client
    // gets the same 200 either way (its intent — "stop uploading" — is met).
    await abandonSession(uploadId);
    return ok({ cancelled: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

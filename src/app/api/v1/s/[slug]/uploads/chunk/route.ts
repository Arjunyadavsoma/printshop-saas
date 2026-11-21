import { NextRequest } from 'next/server';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { appendChunk, getSession, abandonSession, MAX_FILE_BYTES } from '@/lib/pipeline/upload-sessions';
import { AppError, NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * PUT /api/v1/s/[slug]/uploads/chunk?uploadId=… — append one chunk of the
 * resumable upload. The body is raw bytes (not multipart): chunked PUTs
 * stream cleanly and retrying a chunk is idempotent-by-append with the
 * client tracking its own offset (a failed upload restarts the session).
 */
export const PUT = withRateLimit('uploads-chunk', 600, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    await ctx.params;
    const uploadId = req.nextUrl.searchParams.get('uploadId') ?? '';
    const session = getSession(uploadId);
    if (!session) throw new NotFoundError('Upload session not found or expired — restart the upload.');

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) throw new ValidationError('Empty chunk.');

    const received = await appendChunk(uploadId, bytes);
    return ok({ receivedBytes: received, maxBytes: MAX_FILE_BYTES });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg === 'FILE_TOO_LARGE') {
      return fail(new AppError('File is larger than the 50 MB limit — upload was stopped.', 'FILE_TOO_LARGE', 413));
    }
    return fail(toAppError(cause));
  }
});

/** DELETE — customer cancels a mid-upload file. */
export const DELETE = withRateLimit('uploads-chunk', 60, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    await ctx.params;
    const uploadId = req.nextUrl.searchParams.get('uploadId') ?? '';
    if (!getSession(uploadId)) throw new NotFoundError('Upload session not found');
    abandonSession(uploadId);
    return ok({ cancelled: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

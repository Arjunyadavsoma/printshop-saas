import { NextRequest } from 'next/server';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { getStatus } from '@/lib/pipeline/upload-sessions';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/s/[slug]/uploads/status?uploadId=…
 *
 * Offset query for resumable uploads. Returns the bytes received so far +
 * the list of missing chunk indices, so a resuming client can skip the
 * chunks already on disk + only re-upload the gaps.
 *
 * Response: `{ uploadId, receivedBytes, totalBytes, missingChunks, complete, status }`.
 *  - `missingChunks`: 0-based indices not yet received (empty when complete).
 *  - `complete`: true when every expected chunk is present.
 *  - `status`: 'active' | 'expired' | 'completed'.
 *
 * A missing OR expired session returns 404 — the client must call /init to
 * start a fresh session (the partial bytes are gone).
 */
export const GET = withRateLimit<{ slug: string }>('uploads-status', 240, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    await ctx.params;
    const uploadId = req.nextUrl.searchParams.get('uploadId') ?? '';
    const status = await getStatus(uploadId);
    if (!status) throw new NotFoundError('Upload session not found or expired — restart the upload.');
    return ok(status);
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

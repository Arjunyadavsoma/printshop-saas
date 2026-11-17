import { NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { AppError } from '@platform/core/errors';

/**
 * GET /api/v1/shops/me/jobs?status=needs_review — shopkeeper-authed (JWT).
 *
 * Lists this shop's print jobs (most recent first, capped at 100) with their
 * file names. `?status=` filters by job status; the primary operator use is
 * `status=needs_review` — the website surface for uncertain physical
 * outcomes parked by devices (spec §6 invariant 10). Resolution itself is
 * POST /api/v1/shops/me/jobs/{jobId}/resolve.
 */
export const GET = withRateLimit('jobs-list', 60, 60, async (req): Promise<NextResponse> => {
  try {
    const header = req.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return fail(toAppError(new AppError('Missing bearer token', 'UNAUTHORIZED', 401)));
    const container = getContainer();
    const claims = await container.auth.verifyAccessToken(token);
    if (!claims || (claims.role !== 'owner' && claims.role !== 'staff')) {
      return fail(toAppError(new AppError('Shopkeeper authentication required', 'UNAUTHORIZED', 401)));
    }
    const shopId = claims.shopId;
    if (!shopId) return fail(toAppError(new AppError('No shop scope on token', 'UNAUTHORIZED', 401)));

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const allowed = ['queued', 'printing', 'completed', 'failed', 'needs_review', 'cancelled'];
    if (status && !allowed.includes(status)) {
      return fail(toAppError(new AppError(`Unknown job status filter '${status}'`, 'VALIDATION_ERROR', 400)));
    }

    const filter: Record<string, unknown> = { shopId };
    if (status) filter.status = status;
    const rows = await container.db.findMany<{
      id: string; fileId: string; status: string; attempts: number;
      lastError: string | null; startedAt: Date | null; completedAt: Date | null;
      createdAt: Date;
    }>('printJob', filter);
    const sorted = rows
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, 100);

    const jobs: Array<{
      jobId: string; fileId: string; fileName: string | null; status: string;
      attempts: number; lastError: string | null; startedAt: Date | null;
      completedAt: Date | null; createdAt: Date;
    }> = [];
    for (const j of sorted) {
      const file = await container.db.findOne<{ id: string; originalFilename: string }>('printFile', { id: j.fileId });
      jobs.push({
        jobId: j.id,
        fileId: j.fileId,
        fileName: file?.originalFilename ?? null,
        status: j.status,
        attempts: j.attempts,
        lastError: j.lastError,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        createdAt: j.createdAt,
      });
    }
    return ok({ jobs, count: jobs.length });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

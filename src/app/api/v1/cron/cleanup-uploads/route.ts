import { expireOldSessions, activeSessionCount, SESSION_EXPIRY_MS } from '@/lib/pipeline/upload-sessions';

/**
 * POST /api/v1/cron/cleanup-uploads — Vercel Cron janitor for upload sessions.
 *
 * Finds upload sessions older than 1 hour with no recent chunk activity,
 * deletes the partial chunk data from disk, + marks the session as
 * `expired`. Runs hourly (configured in vercel.json `crons`).
 *
 * Authentication: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends
 * this automatically). The secret MUST NOT travel in the URL (logged by
 * every proxy).
 *
 * The endpoint is idempotent — duplicate runs are safe (an already-expired
 * session is gone from the registry, so the next run skips it).
 *
 * Vercel Hobby cron runs hourly; the existing /api/v1/cron/cleanup runs
 * daily for FileCleanupTask records. This endpoint is the upload-session
 * counterpart.
 */

export async function POST(req: Request) {
  // Authenticate — Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedSecret = process.env.CRON_SECRET ?? process.env.SETUP_KEY ?? '';

  if (!expectedSecret || token !== expectedSecret) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } },
      { status: 401 },
    );
  }

  try {
    const beforeActive = activeSessionCount();
    const expired = await expireOldSessions();
    const afterActive = activeSessionCount();
    return Response.json({
      success: true,
      data: {
        expiredSessions: expired,
        activeBefore: beforeActive,
        activeAfter: afterActive,
        expiryMs: SESSION_EXPIRY_MS,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 },
    );
  }
}

/** GET alias — supports Vercel Hobby cron (which sends GET by default). */
export async function GET(req: Request) {
  return POST(req);
}

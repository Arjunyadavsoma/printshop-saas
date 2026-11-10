import { processCleanupTasks } from '@/lib/services/delivery-coordinator';
import { db } from '@/lib/db';

/**
 * GET /api/v1/cron/cleanup — Vercel Cron endpoint.
 *
 * Processes pending FileCleanupTask records whose scheduledAt has passed.
 * Deletes the corresponding cloud storage objects (PDFs that have been
 * durably received by PrintEXE + 15-minute grace period elapsed).
 *
 * Authentication: CRON_SECRET env var (Authorization: Bearer <secret> header
 * ONLY). Vercel Cron automatically sends the Authorization header.
 * Phase 6.7: ?secret= query-string fallback was REMOVED — the secret MUST NOT
 * travel in the URL (logged by every proxy).
 *
 * This endpoint is SAFE:
 * - Only deletes objects with a verified receipt + grace period elapsed
 * - Only deletes the storage object (not business records)
 * - Idempotent (missing objects → marked completed)
 * - Bounded batch (max 10 per invocation, configurable via ?limit=)
 * - Never deletes shared objects without ownership verification
 *
 * Configure in vercel.json crons array: path "/api/v1/cron/cleanup",
 * schedule every 5 minutes.
 *
 * Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`.
 */

const MAX_BATCH = 10;

export async function GET(req: Request) {
  // Authenticate — Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  // Phase 6.7: ?secret= query fallback removed — secret MUST NOT travel in URL.
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedSecret = process.env.CRON_SECRET ?? process.env.SETUP_KEY ?? '';

  if (!expectedSecret || token !== expectedSecret) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } },
      { status: 401 },
    );
  }

  // Parse optional limit (max 50 per invocation)
  const limit = Math.min(parseInt(new URL(req.url).searchParams.get('limit') ?? String(MAX_BATCH), 10), 50);

  try {
    // Process due cleanup tasks
    const result = await processCleanupTasks(limit);

    // Gather operational stats (safe — no customer data)
    let stats = {
      pendingTasks: 0,
      failedTasks: 0,
      oldestPendingAge: null as string | null,
    };

    try {
      const pending = await (db as any).fileCleanupTask.findMany({
        where: { status: 'pending' },
        orderBy: { scheduledAt: 'asc' },
        take: 1,
        select: { scheduledAt: true },
      });
      const pendingCount = await (db as any).fileCleanupTask.count({ where: { status: 'pending' } });
      const failedCount = await (db as any).fileCleanupTask.count({ where: { status: 'failed' } });

      stats = {
        pendingTasks: pendingCount,
        failedTasks: failedCount,
        oldestPendingAge: pending.length > 0 ? pending[0].scheduledAt.toISOString() : null,
      };
    } catch {
      // FileCleanupTask table doesn't exist — stats unavailable
    }

    return Response.json({
      success: true,
      data: {
        ...result,
        ...stats,
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

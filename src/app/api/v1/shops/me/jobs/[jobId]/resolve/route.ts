import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { shopChannel } from '@platform/core/interfaces';
import { AppError, NotFoundError } from '@platform/core/errors';

const ResolveSchema = z.object({
  outcome: z.enum(['completed', 'failed']),
  note: z.string().max(300).optional(),
});

/**
 * POST /api/v1/shops/me/jobs/{jobId}/resolve — shopkeeper-authed (JWT).
 *
 * Operator resolution for a job parked in `needs_review` by a device whose
 * spooler outcome could not be established (uncertain physical print). This
 * is the authoritative website-side counterpart of the device's local
 * resolution: the shopkeeper checks the printer, decides whether the paper
 * actually printed, and records the outcome here.
 *
 * Guarantees (Phase D):
 * - Only jobs in `needs_review` can be resolved (conditional update — a
 *   concurrent device report that already moved the job wins and we return
 *   409 JOB_NOT_IN_NEEDS_REVIEW).
 * - The resolved job is terminal: a later duplicate device report is
 *   idempotent-skipped, and the job can never be re-queued by the device
 *   (no automatic retry exists for needs_review).
 * - WHO resolved it, WHEN, the outcome and the optional note are recorded in
 *   the audit log (`job.resolved`).
 * - Realtime job.completed / job.failed keeps dashboards in sync.
 *
 * Explicit confirmation is inherent: another physical attempt requires the
 * shopkeeper to create a fresh print request (this endpoint never requeues).
 */
export const POST = withRateLimit(
  'job-resolve',
  10,
  60,
  async (req, ctx): Promise<NextResponse> => {
    try {
      // Auth is verified inline (withRateLimit composes over a manual JWT
      // check): device routes use device tokens; this endpoint needs the
      // shopkeeper JWT and its shop scope.
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

      const { jobId: id } = await ctx.params;

      const body = ResolveSchema.parse(await req.json());
      const job = await repos.printJobs.findByIdAndShop(id, shopId);
      if (!job) throw new NotFoundError('Job not found in your shop.');
      if (job.status !== 'needs_review') {
        throw new AppError(
          `Job is '${job.status}' — only jobs parked in needs_review can be resolved.`,
          'JOB_NOT_IN_NEEDS_REVIEW',
          409,
        );
      }

      const now = new Date();
      const resolved = body.outcome === 'completed'
        ? await container.db.update(
            'printJob',
            { id, shopId, status: 'needs_review' },
            { status: 'completed', completedAt: now },
          )
        : await container.db.update(
            'printJob',
            { id, shopId, status: 'needs_review' },
            { status: 'failed', lastError: body.note ?? 'Resolved by operator as failed', attempts: (job.attempts ?? 0) + 1 },
          );
      if (resolved.length === 0) {
        throw new AppError('Job state just changed — reload and retry.', 'JOB_NOT_IN_NEEDS_REVIEW', 409);
      }

      if (body.outcome === 'completed') {
        await repos.files.update(job.fileId, { status: 'completed', printedAt: now });
        const file = await container.db.findOne<{ id: string; orderId: string }>('printFile', { id: job.fileId });
        if (file) {
          const siblings = await repos.files.findByOrder(file.orderId);
          if (siblings.length > 0 && siblings.every((f) => f.status === 'completed')) {
            await repos.orders.update(file.orderId, { status: 'ready' });
            void container.realtime.publish(shopChannel(shopId), 'order.ready', { orderId: file.orderId }).catch(() => {});
          }
        }
        void container.realtime.publish(shopChannel(shopId), 'job.completed', { jobId: id, fileId: job.fileId }).catch(() => {});
      } else {
        await repos.files.update(job.fileId, { status: 'failed' });
        void container.realtime.publish(shopChannel(shopId), 'job.failed', { jobId: id, fileId: job.fileId, error: body.note ?? 'Resolved by operator as failed' }).catch(() => {});
      }

      // Audit — WHO resolved it, when, and the outcome. Never token material.
      try {
        await container.db.insert('auditLog', {
          id: crypto.randomUUID(),
          shopId,
          userId: claims.sub,
          action: 'job.resolved',
          entityType: 'PrintJob',
          entityId: id,
          metadata: JSON.stringify({
            outcome: body.outcome,
            note: body.note ?? null,
            resolvedAt: now.toISOString(),
            resolvedByRole: claims.role,
            priorStatus: 'needs_review',
          }),
          ip: req.headers.get('x-forwarded-for') || null,
          createdAt: now,
        });
      } catch { /* audit is non-fatal */ }

      return ok({
        jobId: id,
        status: body.outcome,
        resolvedBy: claims.sub,
        resolvedAt: now.toISOString(),
        message: `Job recorded as ${body.outcome} by operator resolution. Create a fresh print request if another physical attempt is needed.`,
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
);

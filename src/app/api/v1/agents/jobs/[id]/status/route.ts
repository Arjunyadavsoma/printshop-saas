import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';
import { shopChannel } from '@platform/core/interfaces';

const StatusSchema = z.object({
  status: z.enum(['printing', 'completed', 'failed', 'needs_review']),
  lastError: z.string().max(500).optional(),
  printerName: z.string().max(200).optional(),
  // ── Mobile executor / queue v2 (additive; old clients keep working) ──
  /** The 1-based attempt number this status report refers to. Used by the
   *  idempotency guard: a duplicate (taskId, attempt) report with the same
   *  status is a no-op. Without this, a retried HTTP request from a wedged
   *  mobile app could double-count a state transition. */
  attempt: z.number().int().min(1).optional(),
  /** The IPP job id assigned by the printer (for cross-reference with the
   *  printer's own job panel). Stored on the audit log only — not on the
   *  PrintJob row (the column doesn't exist; we don't want to migrate). */
  ippJobId: z.string().max(120).optional(),
  /** Free-form detail — a stack trace, an IPP status message, a paper jam
   *  description. Stored on the audit log; never auto-retried. */
  detail: z.string().max(2000).optional(),
});

/**
 * POST /api/v1/agents/jobs/:id/status — device-token-authed. The agent reports
 * a status transition (queued→printing→completed|failed|needs_review). Enforces
 * the state machine; updates the PrintJob + File; publishes realtime events so
 * the dashboard updates live. First-claim-wins: a transition that isn't allowed
 * (e.g. an agent claiming a job another agent already claimed) returns 409.
 *
 * `needs_review` is reported by PrintEXE when a job was submitted to the
 * Windows spooler but its physical outcome could not be established (spooler
 * timeout, crash mid-print, ambiguous recovery). The job leaves the printable
 * queue and waits for operator resolution on the website; the operator's
 * decision is reported back as `completed` or `failed`. This keeps the
 * dashboard honest: paper may or may not have come out — the backend never
 * silently retries or claims success for an uncertain job.
 */
export const POST = withDeviceAuth<{ id: string }>(async (req, ctx, { agent, shopId }) => {
  try {
    const { id } = await ctx.params;
    const body = StatusSchema.parse(await req.json());
    const job = await repos.printJobs.findByIdAndShop(id, shopId);
    if (!job) throw new NotFoundError('Job not found');

    const now = new Date();
    const container = getContainer();
    const channel = shopChannel(shopId);

    // ── Idempotency guard for v2 mobile agents ──
    // If the agent sends `attempt`, dedupe on (taskId, attempt, status):
    // a retried HTTP request (e.g. the app crashed mid-flight and retried)
    // is silently absorbed so a single physical event isn't double-counted.
    // PC agents that don't send `attempt` skip this guard (legacy flow).
    if (body.attempt !== undefined) {
      const idemKey = `job:status:${id}:${body.attempt}:${body.status}`;
      const existing = await container.cache.get(idemKey);
      if (existing) {
        return ok({ jobId: id, status: body.status, applied: false, idempotent: true, reason: 'duplicate (taskId, attempt, status) report — already applied' });
      }
      // Reserve the key for 24h — long enough to absorb retries but short
      // enough that a legitimate same-attempt re-print (different attempt
      // number) still goes through.
      await container.cache.set(idemKey, new Date().toISOString(), 24 * 60 * 60);
    }

    if (body.status === 'printing') {
      // ATOMIC CLAIM: conditional update WHERE id AND status='queued'.
      // Only one concurrent agent's update will affect a row; the loser
      // gets an empty result → skipped. This is atomic at the DB level
      // (UPDATE ... WHERE id=? AND status='queued' — row-level locking).
      const claimed = await container.db.update(
        'printJob',
        { id, shopId, status: 'queued' },
        { status: 'printing', agentId: agent.id, startedAt: now },
      );
      if (claimed.length === 0) {
        // Distinguish crash-leftover from a live multi-device race loss: the
        // job row records WHO claimed it (job.agentId). If it was THIS agent
        // in a previous process run, the physical outcome is unknown (crash
        // recovery — PrintEXE parks the job locally and reports
        // needs_review). If it was a different agent, that device is actively
        // printing — the loser simply cancels its local copy.
        const reason = job.agentId === agent.id
          ? `job is 'printing' — claimed by this device in a previous session (crash recovery: outcome unknown, do not reprint)`
          : `job is 'printing' — already claimed by another agent`;
        return ok({ jobId: id, skipped: true, reason });
      }
      await repos.files.update(job.fileId, { status: 'printing' });
      await publish(channel, 'job.printing', { jobId: id, fileId: job.fileId });
    } else if (body.status === 'completed') {
      // Idempotent: conditional update WHERE id AND status='printing'.
      // If the job is already 'completed' (duplicate ack), this is a no-op.
      let updated = await container.db.update(
        'printJob',
        { id, shopId, status: 'printing' },
        { status: 'completed', completedAt: now },
      );
      if (updated.length === 0) {
        // Operator resolution path: a job parked in needs_review (uncertain
        // physical outcome) can be confirmed completed by the device after
        // the operator marks it resolved locally.
        updated = await container.db.update(
          'printJob',
          { id, shopId, status: 'needs_review' },
          { status: 'completed', completedAt: now },
        );
      }
      if (updated.length === 0) {
        return ok({ jobId: id, skipped: true, reason: `job is '${job.status}' — not in 'printing' or 'needs_review' state (duplicate ack or already completed)` });
      }
      await repos.files.update(job.fileId, { status: 'completed', printedAt: now });
      await publish(channel, 'job.completed', { jobId: id, fileId: job.fileId });
      await maybeMarkOrderReady(job.fileId, shopId, channel);
    } else if (body.status === 'needs_review') {
      // Uncertain physical outcome. Allowed from 'printing' (claimed but the
      // spooler result could not be established) or from 'queued' (the device
      // knows the paper state is unknown before a claim completes — e.g.
      // crash recovery). Both transitions are conditional so a concurrent
      // state change wins and we return skipped honestly.
      let updated = await container.db.update(
        'printJob',
        { id, shopId, status: 'printing' },
        { status: 'needs_review', lastError: body.lastError ?? null },
      );
      if (updated.length === 0) {
        updated = await container.db.update(
          'printJob',
          { id, shopId, status: 'queued' },
          { status: 'needs_review', lastError: body.lastError ?? null },
        );
      }
      if (updated.length === 0) {
        return ok({ jobId: id, skipped: true, reason: `job is '${job.status}' — needs_review only applies to 'printing' or 'queued' jobs` });
      }
      // NOTE: the FILE's status is deliberately NOT changed here. The device
      // path previously wrote file.status='needs_review', which collides with
      // the shop/customer UIs' meaning of the same value on files ("needs a
      // page count before pricing") — a paid, already-priced file parked by
      // the device appeared in those panels and could not be resolved there.
      // The file stays 'printing' (set at claim time); the JOB row carries
      // needs_review, which is what the devices page and job state machine
      // use. The operator-resolution endpoint (POST /shops/me/jobs/{id}/resolve)
      // moves both job and file when a human decides the outcome.
      await publish(channel, 'job.needs_review', {
        jobId: id,
        fileId: job.fileId,
        error: body.lastError,
      });
    } else if (body.status === 'failed') {
      // Increment the attempts counter on failure so retry logic can
      // track how many times a job has been attempted.
      await repos.printJobs.update(id, {
        status: 'failed',
        lastError: body.lastError ?? null,
        attempts: (job.attempts ?? 0) + 1,
      });
      await repos.files.update(job.fileId, { status: 'failed' });
      await publish(channel, 'job.failed', { jobId: id, fileId: job.fileId, error: body.lastError });
    }

    if (body.printerName) await repos.printAgents.update(agent.id, { printerName: body.printerName });

    // Audit (best-effort) — captures the new v2 fields (attempt, ippJobId,
    // detail) so the shopkeeper has a forensic trail when reviewing an
    // uncertain/failed task.
    try {
      await container.db.insert('auditLog', {
        id: crypto.randomUUID(),
        shopId,
        userId: null,
        action: 'job.status',
        entityType: 'PrintJob',
        entityId: id,
        metadata: JSON.stringify({
          agentId: agent.id,
          status: body.status,
          attempt: body.attempt ?? null,
          ippJobId: body.ippJobId ?? null,
          detail: body.detail ?? null,
          lastError: body.lastError ?? null,
        }),
        ip: req.headers.get('x-forwarded-for') || null,
        createdAt: now,
      });
    } catch {
      // best-effort
    }

    return ok({ jobId: id, status: body.status, applied: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

async function publish(channel: string, event: string, payload: unknown): Promise<void> {
  try { await getContainer().realtime.publish(channel, event, payload); } catch { /* best-effort */ }
}

async function maybeMarkOrderReady(fileId: string, shopId: string, channel: string): Promise<void> {
  void shopId;
  const file = await getContainer().db.findOne<{ id: string; orderId: string }>('printFile', { id: fileId });
  if (!file) return;
  const siblings = await repos.files.findByOrder(file.orderId);
  if (siblings.length > 0 && siblings.every((f) => f.status === 'completed')) {
    await repos.orders.update(file.orderId, { status: 'ready' });
    await publish(channel, 'order.ready', { orderId: file.orderId });
  }
}

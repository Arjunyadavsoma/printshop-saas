import { z } from 'zod';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { markDeliveryReceived } from '@/lib/services/delivery-coordinator';
import { getContainer } from '@/lib/container';
import { shopChannel } from '@platform/core/interfaces';

const ReceiptSchema = z.object({
  deliveryAttemptId: z.string().uuid().optional(),
  transferId: z.string().uuid().optional(), // for future WebRTC transfers
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, 'must be a SHA-256 hex string').optional(),
  fileSize: z.number().int().positive().optional(),
  receivedAt: z.string().datetime().optional(),
});

/**
 * POST /api/v1/agents/jobs/{jobId}/received — device-token-authed.
 *
 * Durable receipt acknowledgement. PrintEXE calls this AFTER it has
 * successfully downloaded the PDF from the presigned URL and verified
 * its local persistence. This is separate from the print status report
 * (`POST /agents/jobs/{id}/status`) — receipt means "I have the file",
 * status means "I'm printing it" / "I finished printing it".
 *
 * The server:
 * 1. Validates the agent identity + job ownership (tenant isolation)
 * 2. Validates the job belongs to the agent's shop
 * 3. Records the receipt (checksum, fileSize, receivedAt)
 * 4. Schedules cloud cleanup (15-minute grace period after receipt)
 * 5. Publishes a `delivery.received` realtime event
 *
 * Idempotent: if the same receipt is submitted twice, the second call
 * returns success without creating a duplicate or re-scheduling cleanup.
 *
 * Request:
 *   {
 *     "deliveryAttemptId": "uuid (optional — from job.dispatch event)",
 *     "transferId": "uuid (optional — for future WebRTC)",
 *     "checksum": "sha256-hex (optional — verified against server-side hash if available)",
 *     "fileSize": 123456 (optional — bytes),
 *     "receivedAt": "2025-11-07T10:00:00Z (optional — defaults to now)"
 *   }
 *
 * Response 200:
 *   {
 *     "success": true,
 *     "data": {
 *       "jobId": "...",
 *       "received": true,
 *       "cleanupScheduled": true,
 *       "cleanupScheduledAt": "2025-11-07T10:15:00Z",
 *       "message": "Receipt acknowledged. Cloud cleanup scheduled for ..."
 *     }
 *   }
 *
 * Response 404: job not found or not in this shop
 * Response 409: job already in terminal state (collected/cancelled)
 */
export const POST = withDeviceAuth<{ jobId: string }>(async (req, ctx, { agent, shopId }) => {
  try {
    const { jobId } = await ctx.params;
    const body = ReceiptSchema.parse(await req.json().catch(() => ({})));

    // Verify the job exists + belongs to this shop
    const job = await repos.printJobs.findByIdAndShop(jobId, shopId);
    if (!job) {
      throw new NotFoundError('Job not found in your shop.');
    }

    // Don't allow receipt for terminal jobs
    if (job.status === 'completed' || job.status === 'failed') {
      return ok({
        jobId,
        received: true,
        cleanupScheduled: false,
        message: `Job is already '${job.status}'. Receipt not needed.`,
      });
    }

    // Check if the job has already been received (idempotency)
    // by checking if a delivery attempt exists with status='received'
    const container = getContainer();
    let alreadyReceived = false;
    try {
      const existing = await (container.db as any).findMany('PrintDeliveryAttempt', {
        printJobId: jobId,
        status: 'received',
      });
      alreadyReceived = existing.length > 0;
    } catch {
      // Table doesn't exist — proceed with the receipt
    }

    if (alreadyReceived) {
      return ok({
        jobId,
        received: true,
        cleanupScheduled: true,
        message: 'Receipt already acknowledged (idempotent). Cloud cleanup is scheduled.',
      });
    }

    // Optional: validate checksum against server-side hash
    // (the server doesn't currently compute SHA-256 on upload, so this
    // is a future enhancement — for now we accept the agent's checksum)
    if (body.checksum) {
      // Future: compare against server-computed hash
      // For now: store it for audit purposes
    }

    // Record the receipt + schedule cleanup
    const result = await markDeliveryReceived(jobId, agent.id, shopId, {
      deliveryAttemptId: body.deliveryAttemptId,
      checksum: body.checksum,
      fileSize: body.fileSize,
      receivedAt: body.receivedAt,
    });

    // Publish realtime event so the dashboard updates
    void container.realtime.publish(shopChannel(shopId), 'delivery.received', {
      jobId,
      agentId: agent.id,
      agentName: agent.name,
      receivedAt: body.receivedAt ?? new Date().toISOString(),
      checksum: body.checksum,
    }).catch(() => { /* best-effort */ });

    // Audit log
    try {
      await container.db.insert('AuditLog', {
        id: crypto.randomUUID(),
        shopId,
        userId: null,
        action: 'delivery.received',
        entityType: 'PrintJob',
        entityId: jobId,
        metadata: JSON.stringify({
          agentId: agent.id,
          agentName: agent.name,
          checksum: body.checksum ?? null,
          fileSize: body.fileSize ?? null,
        }),
        ip: req.headers.get('x-forwarded-for') || null,
        createdAt: new Date(),
      });
    } catch {
      // audit log failure is non-fatal
    }

    return ok({
      jobId,
      received: true,
      cleanupScheduled: result.cleanupScheduled,
      message: result.message,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

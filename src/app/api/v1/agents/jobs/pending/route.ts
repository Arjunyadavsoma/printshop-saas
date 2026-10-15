import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { shopChannel } from '@platform/core/interfaces';

interface PendingJob {
  jobId: string;
  fileId: string;
  orderId: string;
  filename: string;
  downloadUrl: string;
  copies: number;
  colorMode: string;
  duplex: boolean;
  paperSize: string;
  pageRange: string | null;
}

/**
 * GET /api/v1/agents/jobs/pending — device-token-authed. Returns queued jobs
 * for the agent's shop, each with a presigned download URL + print settings.
 * The agent claims a job by POSTing /agents/jobs/:id/status {status:'printing'}.
 */
export const GET = withDeviceAuth(async (_req, _ctx, { agent, shopId }) => {
  const container = getContainer();
  const queued = await repos.printJobs.findQueuedByShop(shopId, 10);
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const jobs: PendingJob[] = [];
  for (const j of queued) {
    // The job is already shop-scoped via findQueuedByShop; look the file up by id.
    const file = await container.db.findOne<{ id: string; orderId: string; originalFilename: string; storageKey: string; copies: number; colorMode: string; duplex: boolean; paperSize: string; pageRange: string | null }>('printFile', { id: j.fileId });
    if (!file) continue;
    const downloadUrl = `${base}${await container.storage.getPresignedDownloadUrl(file.storageKey, 900)}`;
    jobs.push({
      jobId: j.id,
      fileId: file.id,
      orderId: file.orderId,
      filename: file.originalFilename,
      downloadUrl,
      copies: file.copies,
      colorMode: file.colorMode,
      duplex: file.duplex,
      paperSize: file.paperSize,
      pageRange: file.pageRange,
    });
  }
  // Presence ping so the dashboard sees the agent polling.
  void container.realtime.publish(shopChannel(shopId), 'agent.heartbeat', { agentId: agent.id }).catch(() => {});
  return ok({ jobs, agentId: agent.id });
});

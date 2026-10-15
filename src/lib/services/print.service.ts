import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { shopChannel } from '@platform/core/interfaces';

let registered = false;

/**
 * Register the print-queue handler (idempotent).
 *
 * The handler is the OFFLINE FALLBACK: it only runs the in-process print
 * simulation when NO real agent is online for the shop. When an agent IS
 * online (heartbeated within 30s), the dispatch path already pushed a
 * `job.dispatch` event to the agent's socket.io room; the agent claims the
 * job and reports status back via POST /agents/jobs/:id/status (which
 * publishes the realtime events the dashboard listens for). First-claim-wins
 * is enforced by the status state machine in that endpoint.
 */
export function ensurePrintHandler(): void {
  if (registered) return;
  registered = true;
  const queue = getContainer().queue;
  void queue.process<{ jobId: string; fileId: string; shopId: string }>(
    'print',
    async (payload) => {
      const { jobId, fileId, shopId } = payload;
      // If a real agent is online, let it handle the job — don't simulate.
      if (await repos.printAgents.isAnyOnline(shopId)) {
        return; // the agent claims + prints + reports via the status endpoint
      }
      // In production: jobs stay 'queued' until an agent picks them up.
      // The in-process simulation is a DEV-ONLY fallback so the demo works
      // without a running agent.
      if (process.env.NODE_ENV === 'production') {
        return; // no agent online + production = job stays queued
      }
      // Dev-only offline fallback: simulate printing in-process.
      await repos.printJobs.update(jobId, { status: 'printing', agentId: 'in-process', startedAt: new Date() });
      await repos.files.update(fileId, { status: 'printing' });
      await publish(shopId, 'job.printing', { jobId, fileId });
      await delay(1500);
      await repos.printJobs.update(jobId, { status: 'completed', completedAt: new Date() });
      await repos.files.update(fileId, { status: 'completed', printedAt: new Date() });
      await publish(shopId, 'job.completed', { jobId, fileId });
      await maybeMarkOrderReady(fileId, shopId);
    },
  );
}

/**
 * Dispatch a job to the agent (when one is online) by publishing a
 * `job.dispatch` event to the shop's realtime room. The agent, connected via
 * socket.io, receives it, claims the job, downloads + prints, and reports
 * status. Called by the print route + the webhook's auto-dispatch.
 */
export async function dispatchToAgent(shopId: string, jobId: string, fileId: string): Promise<void> {
  const container = getContainer();
  const file = await container.db.findOne<{ id: string; orderId: string; storageKey: string; originalFilename: string; copies: number; colorMode: string; duplex: boolean; paperSize: string; pageRange: string | null }>('printFile', { id: fileId });
  if (!file) return;
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const downloadUrl = `${base}${await container.storage.getPresignedDownloadUrl(file.storageKey, 900)}`;
  // Flat shape matching the agent's PendingJob (so copies/colorMode/etc. land
  // on the right fields, not nested under `settings`).
  await publish(shopId, 'job.dispatch', {
    jobId,
    fileId,
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

async function findFileById(id: string) {
  return getContainer().db.findOne<{ id: string; orderId: string }>('printFile', { id });
}

async function maybeMarkOrderReady(fileId: string, shopId: string): Promise<void> {
  const file = await findFileById(fileId);
  if (!file) return;
  const siblings = await repos.files.findByOrder(file.orderId);
  if (siblings.length === 0) return;
  if (siblings.every((f) => f.status === 'completed')) {
    await repos.orders.update(file.orderId, { status: 'ready' });
    await publish(shopId, 'order.ready', { orderId: file.orderId });
  }
}

async function publish(shopId: string, event: string, payload: unknown): Promise<void> {
  try {
    await getContainer().realtime.publish(shopChannel(shopId), event, payload);
  } catch {
    // realtime is best-effort.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { shopChannel } from '@platform/core/interfaces';
import { canTransitionOrder } from '@platform/core/domain';

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
 * Resolve a presigned storage URL to a fully-qualified download URL.
 *
 * The storage adapter returns EITHER:
 *   - an absolute URL (Supabase/R2/S3 presigned — `https://...`), OR
 *   - a relative path (the in-memory dev adapter — `/api/v1/storage/get?...`).
 *
 * Previously we concatenated `${base}${url}` unconditionally, which produced
 * broken URLs like `https://printshop-saas-three.vercel.apphttps://r2.dev/...`
 * on production storage adapters. This helper detects absolute vs relative
 * and only prepends the deployment base for relative paths.
 */
function resolveDownloadUrl(presignedUrl: string, base: string): string {
  if (/^https?:\/\//i.test(presignedUrl)) return presignedUrl; // already absolute
  if (presignedUrl.startsWith('/')) return `${base}${presignedUrl}`;
  return `${base}/${presignedUrl}`;
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
  const downloadUrl = resolveDownloadUrl(
    await container.storage.getPresignedDownloadUrl(file.storageKey, 900),
    base,
  );
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

/**
 * Mark the order 'ready' IF all its files are completed — but only if the
 * order's current status permits the transition. Previously this bypassed
 * the state machine (a shopkeeper cancelling mid-print would be silently
 * reverted to 'ready'). The `canTransitionOrder` guard ensures we don't
 * flip e.g. 'cancelled' or 'collected' back to 'ready'.
 *
 * This is the SINGLE source of truth for the "all files done → order ready"
 * rule. The agent status endpoint (`/api/v1/agents/jobs/[id]/status`) calls
 * this too — it must not duplicate the logic.
 */
export async function maybeMarkOrderReady(fileId: string, shopId: string): Promise<void> {
  const file = await findFileById(fileId);
  if (!file) return;
  const siblings = await repos.files.findByOrder(file.orderId);
  if (siblings.length === 0) return;
  if (!siblings.every((f) => f.status === 'completed')) return;
  // Fetch the order to check the current status before transitioning.
  const order = await repos.orders.findById(file.orderId);
  if (!order) return;
  if (!canTransitionOrder(order.status, 'ready')) return; // state-machine guard
  await repos.orders.update(file.orderId, { status: 'ready' });
  await publish(shopId, 'order.ready', { orderId: file.orderId });
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

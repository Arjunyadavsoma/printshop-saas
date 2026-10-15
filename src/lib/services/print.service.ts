import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { shopChannel } from '@platform/core/interfaces';

let registered = false;

/**
 * Register the print-queue handler (idempotent). The handler simulates what
 * the real print-agent daemon will do in Phase 6: download the file, send to
 * the local printer, report status transitions. Here it runs in-process with
 * a short delay so the dashboard can observe printing → ready live.
 */
export function ensurePrintHandler(): void {
  if (registered) return;
  registered = true;
  const queue = getContainer().queue;
  void queue.process<{ jobId: string; fileId: string; shopId: string }>(
    'print',
    async (payload) => {
      const { jobId, fileId, shopId } = payload;
      await repos.printJobs.update(jobId, {
        status: 'printing',
        agentId: 'demo-agent',
        startedAt: new Date(),
      });
      await repos.files.update(fileId, { status: 'printing' });
      await publish(shopId, 'job.printing', { jobId, fileId });

      // Simulate the printer doing its work.
      await delay(1500);

      await repos.printJobs.update(jobId, { status: 'completed', completedAt: new Date() });
      await repos.files.update(fileId, { status: 'completed', printedAt: new Date() });
      await publish(shopId, 'job.completed', { jobId, fileId });

      // If every file in the order is now complete, flip the order to ready.
      await maybeMarkOrderReady(fileId, shopId);
    },
  );
}

/** Look up a file by id alone (unscoped) — used to find the orderId. */
async function findFileById(id: string) {
  return getContainer().db.findOne<{ id: string; orderId: string }>('printFile', { id });
}

async function maybeMarkOrderReady(fileId: string, shopId: string): Promise<void> {
  const file = await findFileById(fileId);
  if (!file) return;
  const siblings = await repos.files.findByOrder(file.orderId);
  if (siblings.length === 0) return;
  const allDone = siblings.every((f) => f.status === 'completed');
  if (allDone) {
    await repos.orders.update(file.orderId, { status: 'ready' });
    await publish(shopId, 'order.ready', { orderId: file.orderId });
  }
}

async function publish(shopId: string, event: string, payload: unknown): Promise<void> {
  try {
    await getContainer().realtime.publish(shopChannel(shopId), event, payload);
  } catch {
    // realtime is best-effort in the demo.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

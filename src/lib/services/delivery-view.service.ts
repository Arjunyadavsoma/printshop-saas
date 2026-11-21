/**
 * delivery-view.service.ts — read-side joins for PrintDeliveryAttempt
 * (P2-7 customer delivery tracking + P2-8 dashboard delivery history).
 *
 * The PrintDeliveryAttempt table was previously WRITE-ONLY: the agent
 * "job received" reporter inserted rows, but no dashboard or customer
 * surface ever read them back, so shopkeepers couldn't see which device
 * received which file and customers couldn't see delivery progress.
 *
 * The joins are done in JS over the generic db adapter (strict-equality
 * filters only): attempt → printJob → printFile for the file name, and
 * attempt → printAgent for the device name. Deliberately NOT a Prisma
 * relation — the schema keeps printDeliveryAttempt free of FK constraints
 * so a missing/corrupt row can never block the money path.
 */
import { getContainer } from '@/lib/container';

export interface DeliveryViewRow {
  id: string;
  printJobId: string;
  orderId: string | null;
  fileName: string | null;
  deviceName: string | null;
  deliveryMode: string;
  status: string;
  attemptNumber: number;
  fileSize: number | null;
  checksum: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
}

interface AttemptRow {
  id: string;
  printJobId: string;
  agentId: string;
  shopId: string;
  attemptId: number;
  deliveryMode: string;
  status: string;
  checksum: string | null;
  fileSize: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
}

interface JobRow {
  id: string;
  fileId: string;
}

interface FileRow {
  id: string;
  orderId: string;
  originalFilename: string;
}

interface AgentRow {
  id: string;
  name: string;
}

/** Join attempts → job → FILE (the order link lives on PrintFile — PrintJob
 *  has NO orderId column; dispatch resolves it the same way) → agent names. */
async function buildView(
  shopId: string,
  attempts: AttemptRow[],
): Promise<DeliveryViewRow[]> {
  const container = getContainer();
  const [jobs, agents] = await Promise.all([
    container.db.findMany<JobRow>('printJob', { shopId }, { limit: 2000 }),
    container.db.findMany<AgentRow>('printAgent', { shopId }),
  ]);

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  // Resolve file names + the owning orderId per unique file (bounded by the
  // distinct files in this attempt set, ≤ limit).
  const fileById = new Map<string, FileRow>();
  const fileIds = [...new Set(jobs.map((j) => j.fileId).filter(Boolean))];
  await Promise.all(
    fileIds.map(async (fileId) => {
      const f = await container.db.findOne<FileRow>('printFile', { id: fileId });
      if (f) fileById.set(fileId, f);
    }),
  );

  return attempts.map((a) => {
    const job = jobById.get(a.printJobId);
    const file = job ? fileById.get(job.fileId) : undefined;
    return {
      id: a.id,
      printJobId: a.printJobId,
      orderId: file?.orderId ?? null,
      fileName: file?.originalFilename ?? null,
      deviceName: agentNameById.get(a.agentId) ?? a.agentId,
      deliveryMode: a.deliveryMode,
      status: a.status,
      attemptNumber: a.attemptId,
      fileSize: a.fileSize,
      checksum: a.checksum,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      errorCode: a.errorCode,
    };
  });
}

/** P2-8 — dashboard delivery history: the shop's most recent attempts. */
export async function getShopDeliveryHistory(shopId: string, limit = 50): Promise<DeliveryViewRow[]> {
  const container = getContainer();
  const attempts = await container.db.findMany<AttemptRow>(
    'printDeliveryAttempt',
    { shopId },
    { order: ['startedAt', 'desc'], limit },
  );
  return buildView(shopId, attempts);
}

/** P2-7 — customer tracking: the delivery attempts for ONE order. */
export async function getOrderDeliveryAttempts(shopId: string, orderId: string): Promise<DeliveryViewRow[]> {
  const container = getContainer();
  const jobs = await container.db.findMany<JobRow>('printJob', { shopId }, { limit: 2000 });
  const fileIds = [...new Set(jobs.map((j) => j.fileId).filter(Boolean))];
  // Map file → order, then keep only jobs belonging to THIS order.
  const jobsOfOrder = new Set<string>();
  await Promise.all(
    fileIds.map(async (fileId) => {
      const f = await container.db.findOne<FileRow>('printFile', { id: fileId });
      if (f?.orderId === orderId) {
        for (const j of jobs) if (j.fileId === fileId) jobsOfOrder.add(j.id);
      }
    }),
  );
  if (jobsOfOrder.size === 0) return [];
  const attempts = await container.db.findMany<AttemptRow>(
    'printDeliveryAttempt',
    { shopId },
    { order: ['startedAt', 'desc'], limit: 500 },
  );
  return buildView(shopId, attempts.filter((a) => jobsOfOrder.has(a.printJobId)));
}

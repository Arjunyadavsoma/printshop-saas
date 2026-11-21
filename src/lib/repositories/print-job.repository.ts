import type { PrintJob, PrintJobStatus } from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface PrintJobRow {
  id: string;
  shopId: string;
  fileId: string;
  agentId: string | null;
  // ── Product build Phase 1: task-level columns (docs/DATA-MODEL.md) ──
  printerId?: string | null;
  kind?: string | null;
  sourcePages?: number[] | null;
  taskPdfStorageKey?: string | null;
  sheetCount?: number | null;
  copies?: number | null;
  colorMode?: string | null;
  paperSize?: string | null;
  duplex?: boolean | null;
  pagesPerSheet?: number;
  orientation?: string | null;
  scale?: string | null;
  setLabel?: string | null;
  idempotencyKey?: string;
  dispatchedAt?: Date | null;
  printedAt?: Date | null;
  status: string;
  attempts: number;
  lastError: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: PrintJobRow): PrintJob {
  return {
    id: row.id,
    shopId: row.shopId,
    fileId: row.fileId,
    agentId: row.agentId,
    status: row.status as PrintJobStatus,
    attempts: row.attempts,
    lastError: row.lastError,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    printerId: row.printerId ?? null,
    kind: (row.kind as PrintJob['kind']) ?? null,
    sourcePages: row.sourcePages ?? null,
    taskPdfStorageKey: row.taskPdfStorageKey ?? null,
    sheetCount: row.sheetCount ?? null,
    copies: row.copies ?? null,
    colorMode: (row.colorMode as PrintJob['colorMode']) ?? null,
    paperSize: row.paperSize ?? null,
    duplex: row.duplex ?? null,
    pagesPerSheet: row.pagesPerSheet ?? 1,
    orientation: row.orientation ?? null,
    scale: row.scale ?? null,
    setLabel: row.setLabel ?? null,
    idempotencyKey: row.idempotencyKey,
    dispatchedAt: row.dispatchedAt ?? null,
    printedAt: row.printedAt ?? null,
  };
}

export type CreatePrintJobInput = {
  shopId: string;
  fileId: string;
  printerId?: string | null;
  kind?: string | null;
  sourcePages?: number[] | null;
  taskPdfStorageKey?: string | null;
  sheetCount?: number | null;
  copies?: number | null;
  colorMode?: string | null;
  paperSize?: string | null;
  duplex?: boolean | null;
  pagesPerSheet?: number;
  orientation?: string | null;
  scale?: string | null;
  setLabel?: string | null;
  /** Required for task-level jobs; the planner emits
   *  {orderId}:{fileId}:{kind}:{attempt}. Legacy flows get a generated key. */
  idempotencyKey?: string;
  status?: string;
  attempts?: number;
  lastError?: string | null;
  queuedAt?: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

export class PrintJobRepository extends BaseRepository<PrintJobRow> {
  async create(input: CreatePrintJobInput): Promise<PrintJob> {
    const now = new Date();
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      shopId: input.shopId,
      fileId: input.fileId,
      agentId: null,
      printerId: input.printerId ?? null,
      kind: input.kind ?? null,
      sourcePages: input.sourcePages ?? null,
      taskPdfStorageKey: input.taskPdfStorageKey ?? null,
      sheetCount: input.sheetCount ?? null,
      copies: input.copies ?? null,
      colorMode: input.colorMode ?? null,
      paperSize: input.paperSize ?? null,
      duplex: input.duplex ?? null,
      pagesPerSheet: input.pagesPerSheet ?? 1,
      orientation: input.orientation ?? null,
      scale: input.scale ?? null,
      setLabel: input.setLabel ?? null,
      idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      status: input.status ?? 'queued',
      attempts: input.attempts ?? 0,
      lastError: input.lastError ?? null,
      queuedAt: input.queuedAt ?? now,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      createdAt: now,
      updatedAt: now,
    } as PrintJobRow);
    return toDomain(row);
  }

  async findByIdAndShop(id: string, shopId: string): Promise<PrintJob | null> {
    const row = await this.findOne({ id, shopId });
    return row ? toDomain(row) : null;
  }

  async findQueuedByShop(shopId: string, limit = 10): Promise<PrintJob[]> {
    const rows = await this.findMany({ shopId, status: 'queued' }, { limit, order: ['queuedAt', 'asc'] });
    return rows.map(toDomain);
  }

  /** Find ALL PrintJobs for a shop (any status). Used by tests + the
   *  dashboard to show the full queue history. */
  async findAllByShop(shopId: string, limit = 100): Promise<PrintJob[]> {
    const rows = await this.findMany({ shopId }, { limit, order: ['createdAt', 'desc'] });
    return rows.map(toDomain);
  }

  /** All tasks of one order, for the order-detail task table. */
  async findByFile(fileId: string): Promise<PrintJob[]> {
    const rows = await this.findMany({ fileId }, { order: ['queuedAt', 'asc'] });
    return rows.map(toDomain);
  }

  /**
   * Legacy idempotency helper: find any ACTIVE (queued or printing) task for
   * a file of the SAME kind. The product planner calls it per (file, kind)
   * — a crash-retry must not duplicate the COLOR_SET while the BW_SET of the
   * same file may legitimately be queued at the same time.
   */
  async findActiveByFile(fileId: string, kind?: string | null): Promise<PrintJob | null> {
    const filter: Record<string, unknown> = { fileId };
    if (kind !== undefined) filter.kind = kind;
    const rows = await this.findMany(filter, { limit: 20 });
    const active = rows.filter(r => r.status === 'queued' || r.status === 'printing');
    return active[0] ? toDomain(active[0]) : null;
  }

  async update(id: string, patch: Partial<PrintJob>): Promise<void> {
    await this.updateWhere({ id }, patch as Partial<PrintJobRow>);
  }
}

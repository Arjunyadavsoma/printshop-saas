import type { PrintJob, PrintJobStatus } from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface PrintJobRow {
  id: string;
  shopId: string;
  fileId: string;
  agentId: string | null;
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
  };
}

export class PrintJobRepository extends BaseRepository<PrintJobRow> {
  async create(input: { shopId: string; fileId: string }): Promise<PrintJob> {
    const now = new Date();
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      shopId: input.shopId,
      fileId: input.fileId,
      agentId: null,
      status: 'queued',
      attempts: 0,
      lastError: null,
      queuedAt: now,
      startedAt: null,
      completedAt: null,
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

  async update(id: string, patch: Partial<PrintJob>): Promise<void> {
    await this.updateWhere({ id }, patch as Partial<PrintJobRow>);
  }
}

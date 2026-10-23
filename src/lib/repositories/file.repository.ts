import type { PrintFile, FileStatus, ColorMode, PaperSize } from '@platform/core/domain';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@platform/core/errors';

interface PrintFileRow {
  id: string;
  orderId: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  copies: number;
  colorMode: string;
  pageRange: string | null;
  paperSize: string;
  duplex: boolean;
  pricePaise: number;
  status: string;
  printedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: PrintFileRow): PrintFile {
  return {
    id: row.id,
    orderId: row.orderId,
    originalFilename: row.originalFilename,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    copies: row.copies,
    colorMode: row.colorMode as ColorMode,
    pageRange: row.pageRange,
    paperSize: row.paperSize as PaperSize,
    duplex: row.duplex,
    pricePaise: row.pricePaise,
    status: row.status as FileStatus,
    printedAt: row.printedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class FileRepository extends BaseRepository<PrintFileRow> {
  async findByOrder(orderId: string): Promise<PrintFile[]> {
    const rows = await this.findMany({ orderId }, { order: ['createdAt', 'asc'] });
    return rows.map(toDomain);
  }

  /**
   * Batch fetch files for MULTIPLE orders in a single query (avoids the N+1
   * pattern where the analytics/dashboard routes call findByOrder per order
   * in a loop — measured at 50 sequential queries per dashboard refresh).
   * Returns a Map<orderId, PrintFile[]> for easy lookup per order.
   */
  async findByOrderIds(orderIds: string[]): Promise<Map<string, PrintFile[]>> {
    const result = new Map<string, PrintFile[]>();
    if (orderIds.length === 0) return result;
    // Prisma's `in` filter on the orderId field — single SELECT.
    const rows = await this.findMany(
      { orderId: { in: orderIds } },
      { order: ['createdAt', 'asc'] },
    );
    for (const row of rows) {
      const f = toDomain(row);
      const list = result.get(f.orderId) ?? [];
      list.push(f);
      result.set(f.orderId, list);
    }
    return result;
  }

  async findByIdAndOrder(id: string, orderId: string): Promise<PrintFile | null> {
    const row = await this.findOne({ id, orderId });
    return row ? toDomain(row) : null;
  }

  async create(input: {
    orderId: string;
    originalFilename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number | null;
  }): Promise<PrintFile> {
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      originalFilename: input.originalFilename,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      pageCount: input.pageCount,
      copies: 1,
      colorMode: 'bw',
      pageRange: null,
      paperSize: 'a4',
      duplex: false,
      pricePaise: 0,
      status: 'pending',
      printedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PrintFileRow);
    return toDomain(row);
  }

  async update(id: string, patch: Partial<PrintFile>): Promise<PrintFile> {
    const [updated] = await this.updateWhere({ id }, patch as Partial<PrintFileRow>);
    if (!updated) throw new NotFoundError(`File ${id} not found`);
    return toDomain(updated);
  }
}

import type { PrintAgent } from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface PrintAgentRow {
  id: string;
  shopId: string;
  name: string;
  tokenHash: string;
  lastSeenAt: Date | null;
  printerName: string | null;
  isOnline: boolean;
  version: string | null;
  os: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: PrintAgentRow): PrintAgent {
  return {
    id: row.id,
    shopId: row.shopId,
    name: row.name,
    tokenHash: row.tokenHash,
    lastSeenAt: row.lastSeenAt,
    printerName: row.printerName,
    isOnline: row.isOnline,
    version: row.version,
    os: row.os,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrintAgentRepository extends BaseRepository<PrintAgentRow> {
  async findByIdAndShop(id: string, shopId: string): Promise<PrintAgent | null> {
    const row = await this.findOne({ id, shopId });
    return row ? toDomain(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<PrintAgent | null> {
    const row = await this.findOne({ tokenHash });
    return row ? toDomain(row) : null;
  }

  async listByShop(shopId: string): Promise<PrintAgent[]> {
    const rows = await this.findMany({ shopId }, { order: ['createdAt', 'desc'] });
    return rows.map(toDomain);
  }

  /** List ALL agents (admin only). */
  async listAll(limit = 200): Promise<PrintAgent[]> {
    const rows = await this.findMany({}, { limit, order: ['createdAt', 'desc'] });
    return rows.map(toDomain);
  }

  async create(input: { shopId: string; name: string; tokenHash: string }): Promise<PrintAgent> {
    const now = new Date();
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      shopId: input.shopId,
      name: input.name,
      tokenHash: input.tokenHash,
      lastSeenAt: null,
      printerName: null,
      isOnline: false,
      version: null,
      os: null,
      createdAt: now,
      updatedAt: now,
    } as PrintAgentRow);
    return toDomain(row);
  }

  async update(id: string, patch: Partial<PrintAgent>): Promise<void> {
    await this.updateWhere({ id }, patch as Partial<PrintAgentRow>);
  }

  /** Is there an agent that has heartbeated in the last `staleSeconds`? */
  async isAnyOnline(shopId: string, staleSeconds = 30): Promise<boolean> {
    const agents = await this.findMany({ shopId, isOnline: true });
    const cutoff = Date.now() - staleSeconds * 1000;
    return agents.some((a) => a.lastSeenAt && a.lastSeenAt.getTime() >= cutoff);
  }
}

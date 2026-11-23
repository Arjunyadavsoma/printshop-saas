import type { PrintAgent } from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface PrintAgentRow {
  id: string;
  shopId: string;
  name: string;
  tokenHash: string;
  // Token rotation (POST /api/v1/companion/token/rotate): the previous
  // credential's hash is retained briefly so an in-flight request that
  // authenticated with the old token is not locked out mid-rotation.
  prevTokenHash: string | null;
  tokenRotatedAt: Date | null;
  lastSeenAt: Date | null;
  printerName: string | null;
  isOnline: boolean;
  isEnabled: boolean;
  version: string | null;
  os: string | null;
  createdAt: Date;
  updatedAt: Date;
  // ── Mobile executor / queue v2 (additive; defaults applied in toDomain) ──
  kind?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  capabilities?: string | null;
  agentName?: string | null;
}

function toDomain(row: PrintAgentRow): PrintAgent {
  return {
    id: row.id,
    shopId: row.shopId,
    name: row.name,
    tokenHash: row.tokenHash,
    prevTokenHash: row.prevTokenHash ?? null,
    tokenRotatedAt: row.tokenRotatedAt ?? null,
    lastSeenAt: row.lastSeenAt,
    printerName: row.printerName,
    isOnline: row.isOnline,
    // isEnabled defaults to true for legacy rows that predate the column —
    // the Prisma schema sets @default(true) on the column itself, but the
    // in-memory adapter / dev seed path may not always set it explicitly.
    isEnabled: row.isEnabled ?? true,
    version: row.version,
    os: row.os,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Mobile executor / queue v2 — defaults for legacy rows that predate
    // the columns (PC + no platform + empty capabilities JSON array).
    kind: (row.kind === 'MOBILE' ? 'MOBILE' : 'PC') as 'PC' | 'MOBILE',
    platform: row.platform ?? null,
    appVersion: row.appVersion ?? null,
    capabilities: row.capabilities ?? '[]',
    agentName: row.agentName ?? null,
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

  /**
   * Resolve an agent by its PREVIOUS token hash, only while the rotation
   * grace window (overlapMs) is still open. Returns null once the window
   * closes — replayed old credentials stop working.
   */
  async findByPreviousTokenHash(prevTokenHash: string, overlapMs: number): Promise<PrintAgent | null> {
    const row = await this.findOne({ prevTokenHash });
    if (!row || !row.tokenRotatedAt) return null;
    if (Date.now() - new Date(row.tokenRotatedAt).getTime() > overlapMs) return null;
    return toDomain(row);
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

  async create(input: {
    shopId: string;
    name: string;
    tokenHash: string;
    kind?: 'PC' | 'MOBILE';
    platform?: string | null;
    appVersion?: string | null;
    capabilities?: string;
    agentName?: string | null;
  }): Promise<PrintAgent> {
    const now = new Date();
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      shopId: input.shopId,
      name: input.name,
      tokenHash: input.tokenHash,
      lastSeenAt: null,
      printerName: null,
      isOnline: false,
      isEnabled: true,
      version: null,
      os: null,
      createdAt: now,
      updatedAt: now,
      // Mobile executor / queue v2 — defaults for backward compat.
      kind: input.kind ?? 'PC',
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      capabilities: input.capabilities ?? '[]',
      agentName: input.agentName ?? null,
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

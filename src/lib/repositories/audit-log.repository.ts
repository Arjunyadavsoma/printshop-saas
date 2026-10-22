import type { AuditLog } from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface AuditLogRow {
  id: string;
  shopId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: string; // JSON string
  ip: string | null;
  createdAt: Date;
}

export class AuditLogRepository extends BaseRepository<AuditLogRow> {
  /** Append an audit entry. Never throws — audit must never break the flow. */
  async log(input: {
    shopId?: string | null;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  }): Promise<void> {
    try {
      await this.insertOne({
        id: crypto.randomUUID(),
        shopId: input.shopId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: JSON.stringify(input.metadata ?? {}),
        ip: input.ip ?? null,
        createdAt: new Date(),
      } as AuditLogRow);
    } catch {
      // Swallow — auditing is best-effort.
    }
  }

  async findByShop(shopId: string, limit = 50): Promise<AuditLog[]> {
    const rows = await this.findMany({ shopId }, { limit, order: ['createdAt', 'desc'] });
    return rows.map((r) => ({
      id: r.id,
      shopId: r.shopId,
      userId: r.userId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: this.parseJson(r.metadata),
      ip: r.ip,
      createdAt: r.createdAt,
    }));
  }

  /** Find audit entries by action name (used by tests to verify metadata). */
  async findByAction(action: string, limit = 50): Promise<AuditLog[]> {
    const rows = await this.findMany({ action }, { limit, order: ['createdAt', 'desc'] });
    return rows.map((r) => ({
      id: r.id,
      shopId: r.shopId,
      userId: r.userId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: this.parseJson(r.metadata),
      ip: r.ip,
      createdAt: r.createdAt,
    }));
  }

  /** Find audit entries for a specific entity (e.g. an order). Tenant-scoped. */
  async findByEntity(shopId: string, entityId: string, limit = 100): Promise<AuditLog[]> {
    const rows = await this.findMany(
      { shopId, entityId },
      { limit, order: ['createdAt', 'desc'] },
    );
    return rows.map((r) => ({
      id: r.id,
      shopId: r.shopId,
      userId: r.userId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: this.parseJson(r.metadata),
      ip: r.ip,
      createdAt: r.createdAt,
    }));
  }

  /** List recent audit entries across ALL shops (admin only). */
  async listRecent(limit = 50): Promise<AuditLog[]> {
    const rows = await this.findMany({}, { limit, order: ['createdAt', 'desc'] });
    return rows.map((r) => ({
      id: r.id,
      shopId: r.shopId,
      userId: r.userId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: this.parseJson(r.metadata),
      ip: r.ip,
      createdAt: r.createdAt,
    }));
  }
}

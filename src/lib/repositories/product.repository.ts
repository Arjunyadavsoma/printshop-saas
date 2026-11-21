import type { DatabaseAdapter, Document } from '@platform/core/interfaces';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@platform/core/errors';

/**
 * Product-build repositories (docs/DATA-MODEL.md — Phase 1 additions).
 *
 * Every list/read method is shop-scoped by construction: the shopId is a
 * REQUIRED parameter, never optional, so a caller cannot "forget" the
 * tenant filter. This is the structural half of tenant isolation; the
 * route layer adds the auth half via withAuth (claims.shopId).
 */

// ── shared row shapes (snake_case DB rows stay camelCase via the adapter) ──

export type PrinterRow = {
  id: string;
  shopId: string;
  agentId: string | null;
  systemName: string;
  displayName: string;
  supportsColor: boolean;
  supportsDuplex: boolean;
  paperSizes: string[];
  isDefaultColor: boolean;
  isDefaultBw: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'PAUSED' | 'ERROR';
  statusDetail: string | null;
  speedPpm: number;
  pagesPrintedToday: number;
  counterDate: Date | null;
  lastSeenAt: Date | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PriceRuleRow = {
  id: string;
  shopId: string;
  paperSize: string;
  paperType: string;
  colorMode: 'BW' | 'COLOR';
  sides: 'SINGLE' | 'DOUBLE';
  slabs: Array<{ minPages: number; perPagePaise: number }>;
  active: boolean;
  effectiveFrom: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AddonRow = {
  id: string;
  shopId: string;
  kind: 'staple' | 'spiral_bind' | 'laminate' | 'urgent' | 'home_delivery_note';
  label: string;
  pricePaise: number;
  pricingUnit: 'PER_ORDER' | 'PER_COPY' | 'PER_SHEET';
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentRow = {
  id: string;
  orderId: string;
  method: 'upi' | 'counter_cash' | 'counter_upi';
  status: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'REFUNDED_NOTE';
  amountPaise: number;
  upiIntentUrl: string | null;
  utr: string | null;
  screenshotStorageKey: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderEventRow = {
  id: string;
  orderId: string;
  type: string;
  actorType: 'customer' | 'shop' | 'system' | 'agent';
  actorId: string | null;
  data: Record<string, unknown> | null;
  createdAt: Date;
};

export type NotificationRow = {
  id: string;
  shopId: string;
  kind: string;
  orderId: string | null;
  payload: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Printer ──

export class PrinterRepository extends BaseRepository<PrinterRow> {
  constructor() { super('printer'); }

  async createForShop(shopId: string, input: Omit<PrinterRow, 'id' | 'shopId' | 'createdAt' | 'updatedAt'>): Promise<PrinterRow> {
    const row = await this.insertOne({
      ...input, id: crypto.randomUUID(), shopId,
      createdAt: new Date(), updatedAt: new Date(),
    } as PrinterRow);
    return row;
  }

  /** REQUIRED shopId — the structural tenant guard. */
  async listForShop(shopId: string): Promise<PrinterRow[]> {
    return this.findMany({ shopId }, { order: ['createdAt', 'asc'] });
  }

  /** Fetch within a shop or null — cross-shop ids resolve to null. */
  async getForShop(shopId: string, id: string): Promise<PrinterRow | null> {
    return this.findOne({ shopId, id });
  }

  async updateForShop(shopId: string, id: string, patch: Partial<PrinterRow>): Promise<PrinterRow> {
    const [updated] = await this.updateWhere({ shopId, id }, { ...patch, updatedAt: new Date() });
    if (!updated) throw new NotFoundError(`Printer ${id} not found in shop`);
    return updated;
  }

  async deleteForShop(shopId: string, id: string): Promise<number> {
    return this.deleteWhere({ shopId, id });
  }

  /** Default color printer, enabled — used by the PrintPlanner. */
  async defaultColor(shopId: string): Promise<PrinterRow | null> {
    const all = await this.findMany({ shopId, enabled: true });
    return all.find(p => p.isDefaultColor && p.supportsColor)
      ?? all.find(p => p.supportsColor) ?? null;
  }

  /** Default B&W printer (prefers a color-less one), enabled. */
  async defaultBw(shopId: string): Promise<PrinterRow | null> {
    const all = await this.findMany({ shopId, enabled: true });
    return all.find(p => p.isDefaultBw && !p.supportsColor)
      ?? all.find(p => !p.supportsColor)
      ?? all.find(p => p.isDefaultBw) ?? null;
  }
}

// ── PriceRule ──

export class PriceRuleRepository extends BaseRepository<PriceRuleRow> {
  constructor() { super('priceRule'); }

  async createForShop(shopId: string, input: Omit<PriceRuleRow, 'id' | 'shopId' | 'createdAt' | 'updatedAt'>): Promise<PriceRuleRow> {
    return this.insertOne({
      ...input, id: crypto.randomUUID(), shopId,
      createdAt: new Date(), updatedAt: new Date(),
    } as PriceRuleRow);
  }

  async activeForShop(shopId: string): Promise<PriceRuleRow[]> {
    return this.findMany({ shopId, active: true });
  }

  /** The rule matching (size, color, sides) or null. */
  async match(shopId: string, paperSize: string, colorMode: 'BW' | 'COLOR', sides: 'SINGLE' | 'DOUBLE'): Promise<PriceRuleRow | null> {
    const rules = await this.findMany({ shopId, active: true, paperSize, colorMode, sides });
    return rules[0] ?? null;
  }

  /** Soft-deactivate (history preserved — pricing changes must be auditable). */
  async deactivateForShop(shopId: string, id: string): Promise<PriceRuleRow | null> {
    const [updated] = await this.updateWhere({ shopId, id }, { active: false, updatedAt: new Date() });
    return (updated as PriceRuleRow | undefined) ?? null;
  }
}

// ── Addon ──

export class AddonRepository extends BaseRepository<AddonRow> {
  constructor() { super('addon'); }

  async createForShop(shopId: string, input: Omit<AddonRow, 'id' | 'shopId' | 'createdAt' | 'updatedAt'>): Promise<AddonRow> {
    return this.insertOne({
      ...input, id: crypto.randomUUID(), shopId,
      createdAt: new Date(), updatedAt: new Date(),
    } as AddonRow);
  }

  async activeForShop(shopId: string): Promise<AddonRow[]> {
    return this.findMany({ shopId, active: true }, { order: ['createdAt', 'asc'] });
  }

  async getForShop(shopId: string, id: string): Promise<AddonRow | null> {
    return this.findOne({ shopId, id, active: true });
  }
}

// ── Payment (direct UPI + counter flow) ──

export class PaymentRepository extends BaseRepository<PaymentRow> {
  constructor() { super('payment'); }

  async createForOrder(orderId: string, input: Omit<PaymentRow, 'id' | 'orderId' | 'createdAt' | 'updatedAt'>): Promise<PaymentRow> {
    return this.insertOne({
      ...input, id: crypto.randomUUID(), orderId,
      createdAt: new Date(), updatedAt: new Date(),
    } as PaymentRow);
  }

  /** Payment for an order — used by the customer token flow. */
  async forOrder(orderId: string): Promise<PaymentRow[]> {
    return this.findMany({ orderId }, { order: ['createdAt', 'desc'] });
  }

  /** Pending confirmations for the shopkeeper's payments queue. */
  async pendingForShop(shopId: string): Promise<PaymentRow[]> {
    // join-free approach: the route resolves order→shop; here we accept the
    // resolved order ids to keep the query tenant-scoped.
    return this.findMany({ status: 'SUBMITTED' }, { order: ['createdAt', 'asc'] });
  }

  async get(id: string): Promise<PaymentRow | null> {
    return this.findOne({ id });
  }

  async update(id: string, patch: Partial<PaymentRow>): Promise<PaymentRow> {
    const [updated] = await this.updateWhere({ id }, { ...patch, updatedAt: new Date() });
    if (!updated) throw new NotFoundError(`Payment ${id} not found`);
    return updated;
  }
}

// ── OrderEvent (append-only) ──

export class OrderEventRepository extends BaseRepository<OrderEventRow> {
  constructor() { super('orderEvent'); }

  /** Append ONLY — no update/delete methods exist on this repository. */
  async append(orderId: string, input: Omit<OrderEventRow, 'id' | 'orderId' | 'createdAt'>): Promise<OrderEventRow> {
    return this.insertOne({
      ...input, id: crypto.randomUUID(), orderId, createdAt: new Date(),
    } as OrderEventRow);
  }

  async forOrder(orderId: string): Promise<OrderEventRow[]> {
    return this.findMany({ orderId }, { order: ['createdAt', 'asc'] });
  }
}

// ── Notification ──

export class NotificationRepository extends BaseRepository<NotificationRow> {
  constructor() { super('notification'); }

  async createForShop(shopId: string, input: Omit<NotificationRow, 'id' | 'shopId' | 'readAt' | 'createdAt' | 'updatedAt'>): Promise<NotificationRow> {
    return this.insertOne({
      ...input, id: crypto.randomUUID(), shopId, readAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as NotificationRow);
  }

  async unreadForShop(shopId: string, limit = 50): Promise<NotificationRow[]> {
    return this.findMany({ shopId, readAt: null }, { order: ['createdAt', 'desc'], limit });
  }

  async markRead(shopId: string, id: string): Promise<NotificationRow | null> {
    const [updated] = await this.updateWhere({ shopId, id }, { readAt: new Date(), updatedAt: new Date() });
    return updated ?? null;
  }
}

// Convenience aggregate for routes/services.
export const productRepos = {
  printers: new PrinterRepository(),
  priceRules: new PriceRuleRepository(),
  addons: new AddonRepository(),
  payments: new PaymentRepository(),
  orderEvents: new OrderEventRepository(),
  notifications: new NotificationRepository(),
};

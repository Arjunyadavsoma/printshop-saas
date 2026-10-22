import type { Order, OrderStatus, PaymentProvider } from '@platform/core/domain';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@platform/core/errors';

interface OrderRow {
  id: string;
  shopId: string;
  customerToken: string;
  status: string;
  totalAmountPaise: number;
  currency: string;
  paymentProvider: string | null;
  paymentTxnId: string | null;
  paymentUtr: string | null;
  paidAt: Date | null;
  customerPhone: string | null;
  notes: string | null;
  tokenNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: OrderRow): Order {
  return {
    id: row.id,
    shopId: row.shopId,
    customerToken: row.customerToken,
    status: row.status as OrderStatus,
    totalAmountPaise: row.totalAmountPaise,
    currency: row.currency,
    paymentProvider: (row.paymentProvider as PaymentProvider | null) ?? null,
    paymentTxnId: row.paymentTxnId,
    paymentUtr: row.paymentUtr,
    paidAt: row.paidAt,
    customerPhone: row.customerPhone,
    notes: row.notes,
    tokenNumber: row.tokenNumber,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface OrderListOptions {
  status?: OrderStatus;
  limit?: number;
  offset?: number;
}

export class OrderRepository extends BaseRepository<OrderRow> {
  /** Public lookup by id (no shop scope) — used by the customer status poll. */
  async findById(id: string): Promise<Order | null> {
    const row = await this.findOne({ id });
    return row ? toDomain(row) : null;
  }

  /** Tenant-scoped lookup — the only accessor the shop-owner routes use. */
  async findByIdAndShop(id: string, shopId: string): Promise<Order | null> {
    const row = await this.findOne({ id, shopId });
    return row ? toDomain(row) : null;
  }

  async listByShop(shopId: string, opts: OrderListOptions = {}): Promise<Order[]> {
    const filter: Record<string, unknown> = { shopId };
    if (opts.status) filter.status = opts.status;
    const rows = await this.findMany(filter, {
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      order: ['createdAt', 'desc'],
    });
    return rows.map(toDomain);
  }

  /** List ALL orders across all shops (admin only). */
  async listAll(opts: { status?: string; limit?: number; offset?: number } = {}): Promise<Order[]> {
    const filter: Record<string, unknown> = {};
    if (opts.status) filter.status = opts.status;
    const rows = await this.findMany(filter, {
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      order: ['createdAt', 'desc'],
    });
    return rows.map(toDomain);
  }

  async countByShop(shopId: string, status?: OrderStatus): Promise<number> {
    const filter: Record<string, unknown> = { shopId };
    if (status) filter.status = status;
    return this.countWhere(filter);
  }

  /** Find an order by its per-shop token number (uniqueness check). */
  async findByTokenNumber(shopId: string, tokenNumber: string): Promise<Order | null> {
    const row = await this.findOne({ shopId, tokenNumber });
    return row ? toDomain(row) : null;
  }

  /** Count ALL orders (admin only). */
  async countAll(status?: string): Promise<number> {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    return this.countWhere(filter);
  }

  async create(input: {
    shopId: string;
    customerToken: string;
    customerPhone?: string | null;
    notes?: string | null;
    tokenNumber?: string | null;
  }): Promise<Order> {
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      shopId: input.shopId,
      customerToken: input.customerToken,
      status: 'awaiting_payment' as OrderStatus,
      totalAmountPaise: 0,
      currency: 'INR',
      paymentProvider: null,
      paymentTxnId: null,
      paymentUtr: null,
      paidAt: null,
      customerPhone: input.customerPhone ?? null,
      notes: input.notes ?? null,
      tokenNumber: input.tokenNumber ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as OrderRow);
    return toDomain(row);
  }

  async update(id: string, patch: Partial<Order>): Promise<Order> {
    const [updated] = await this.updateWhere({ id }, patch as Partial<OrderRow>);
    if (!updated) throw new NotFoundError(`Order ${id} not found`);
    return toDomain(updated);
  }

  /** Tenant-scoped update — guards against cross-tenant mutation. */
  async updateByShop(id: string, shopId: string, patch: Partial<Order>): Promise<Order | null> {
    const [updated] = await this.updateWhere({ id, shopId }, patch as Partial<OrderRow>);
    return updated ? toDomain(updated) : null;
  }
}

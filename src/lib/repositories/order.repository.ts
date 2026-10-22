import type { Order, OrderStatus, PaymentProvider } from '@platform/core/domain';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@platform/core/errors';
import { isUniqueConstraintError, uniqueViolationFields } from './errors';

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

  /**
   * Race-safe order creation with a per-shop sequential tokenNumber.
   *
   * Strategy (DB-constraint-backed retry loop):
   *   1. Compute a candidate token from `countByShop() + 1 + attempt`. The
   *      count is re-fetched on every retry so the candidate reflects the
   *      latest committed state, not a stale snapshot from the first attempt.
   *   2. INSERT the order with that candidate. If two concurrent INSERTs
   *      race for the same candidate, the database's UNIQUE constraint on
   *      (shopId, tokenNumber) rejects the second with a P2002 / 23505 /
   *      SQLITE_CONSTRAINT_UNIQUE error.
   *   3. On a unique-violation specifically on `tokenNumber`, regenerate
   *      the candidate (count + 1 + next-attempt) and retry. The retry
   *      uses a FRESH order id (always — `insertOne` generates a fresh UUID
   *      per call) so a partially-applied INSERT cannot create a duplicate
   *      order — the DB either accepts the whole INSERT or rejects it
   *      atomically (there is no partial insert). Payment side effects
   *      happen LATER (at checkout / webhook) and are independently
   *      idempotent via the `paymentTxnId` UNIQUE constraint, so a retry
   *      here cannot double-charge.
   *   4. After MAX_ATTEMPTS retries, fall back to NULL tokenNumber (the
   *      shopkeeper references the order by `customerToken` instead). This
   *      is the documented graceful-degradation behaviour — no order is
   *      ever lost because of a token allocation failure.
   *
   * Why a transaction is NOT used here:
   *   - The PrismaDatabaseAdapter exposes `findOne/findMany/insert/update/
   *     count` but does NOT expose `$transaction` (the InMemoryDatabaseAdapter
   *     would need its own transaction semantics too). A multi-statement
   *     transaction wouldn't help anyway — the race is between two
   *     INDEPENDENT transactions, and only the DB-level UNIQUE constraint
   *     can detect it. The constraint + retry loop is the canonical pattern
   *     for race-safe monotonic allocation in Postgres/SQLite.
   *
   * @param shopId - the shop the order belongs to (tenant scope)
   * @param base - the order fields the caller supplies. `customerToken` is
   *               regenerated per-attempt from the caller-supplied generator
   *               so that even a stale INSERT (defensively) cannot create a
   *               second order with the same customerToken.
   * @param tokenCandidate - a function that, given the current order count
   *                         for the shop + the attempt number, returns a
   *                         candidate tokenNumber. Injected so the route
   *                         layer can swap the encoding (A001 vs B104 etc.)
   *                         without the repository depending on @platform/utils.
   * @param fallbackCustomerToken - if the supplied customerToken generator
   *                                is omitted, this function is called per
   *                                attempt to mint a fresh random token.
   */
  async createWithUniqueToken(
    shopId: string,
    base: {
      customerPhone?: string | null;
      notes?: string | null;
      /** Optional: the caller's preferred customerToken (e.g. from
       * generateOrderToken). If omitted, a fresh random token is minted
       * per attempt. */
      customerToken?: string;
      /** Optional: regenerate the customerToken per attempt (used when the
       * caller wants the repository to own the regeneration). */
      regenerateCustomerToken?: () => string;
    },
    tokenCandidate: (count: number, attempt: number) => string,
  ): Promise<Order> {
    const MAX_ATTEMPTS = 8;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Re-fetch the count on every retry — a stale count is the whole reason
      // we need the retry loop in the first place.
      const count = await this.countByShop(shopId);
      const candidate = tokenCandidate(count, attempt);
      // Per-attempt customerToken: prefer the caller's generator (so the
      // retry mints a fresh random token), else fall back to the caller's
      // fixed token (only safe if the caller knows it's unique), else mint
      // a fresh one ourselves.
      const customerToken =
        base.regenerateCustomerToken ? base.regenerateCustomerToken()
        : base.customerToken ?? crypto.randomUUID().slice(0, 6).toUpperCase();
      try {
        return await this.create({
          shopId,
          customerToken,
          customerPhone: base.customerPhone ?? null,
          notes: base.notes ?? null,
          tokenNumber: candidate,
        });
      } catch (e) {
        lastError = e;
        // Only retry on a unique-constraint violation that targets tokenNumber.
        // Any other error (e.g. a violation on customerToken, or a connection
        // failure) is a real failure — rethrow so the route returns an error
        // instead of silently looping.
        if (!isUniqueConstraintError(e)) throw e;
        const fields = uniqueViolationFields(e);
        // If the adapter surfaces the target fields, retry ONLY if tokenNumber
        // is among them. If the adapter doesn't surface fields, retry anyway
        // (the only UNIQUE constraint on this table that the route touches via
        // this method is the (shopId, tokenNumber) one).
        if (fields.length > 0 && !fields.includes('tokenNumber') && !fields.includes('shopId')) {
          throw e;
        }
        // Else: fall through to the next attempt (regenerate candidate).
      }
    }
    // Exhausted retries — degrade gracefully with a NULL tokenNumber.
    // The shopkeeper references the order by customerToken instead. This
    // matches the existing fallback documented in the route.
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[order.createWithUniqueToken] exhausted ${MAX_ATTEMPTS} attempts for shop ${shopId}; falling back to NULL tokenNumber. Last error: ${String(lastError)}`,
      );
    }
    return this.create({
      shopId,
      customerToken:
        base.regenerateCustomerToken ? base.regenerateCustomerToken()
        : base.customerToken ?? crypto.randomUUID().slice(0, 6).toUpperCase(),
      customerPhone: base.customerPhone ?? null,
      notes: base.notes ?? null,
      tokenNumber: null,
    });
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

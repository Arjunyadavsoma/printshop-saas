import type { DatabaseAdapter, Document, Filter, TxLike } from '@platform/core/interfaces';
import type { PrismaClient } from '@prisma/client';

/**
 * Prisma-backed {@link DatabaseAdapter} concrete.
 *
 * Dispatches by table name to the matching Prisma model property at runtime,
 * so the repository layer stays table-generic and ORM-swappable: pointing
 * this same client at Postgres (or swapping for a Drizzle-backed concrete)
 * is a config change, not a business-logic change.
 *
 * Booleans, Dates and Json are marshalled by Prisma itself — the repo layer
 * never hand-encodes them.
 */

// Minimal structural view of a Prisma delegate (the part we use). Typed as
// `unknown` at the boundary so we don't couple to Prisma's generated types.
type PrismaDelegate = {
  findFirst: (args: { where: Record<string, unknown> }) => Promise<Document | null>;
  findMany: (args: {
    where: Record<string, unknown>;
    take?: number;
    skip?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }) => Promise<Document[]>;
  create: (args: { data: Document }) => Promise<Document>;
  updateMany: (args: { where: Record<string, unknown>; data: Document }) => Promise<{ count: number }>;
  deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
};

export class PrismaDatabaseAdapter implements DatabaseAdapter {
  readonly provider = 'prisma';
  constructor(private readonly prisma: PrismaClient) {}

  /** Map a logical table name to the Prisma model property. */
  private delegate(table: string): PrismaDelegate {
    const d = (this.prisma as unknown as Record<string, PrismaDelegate | undefined>)[table];
    if (!d) {
      throw new Error(`PrismaDatabaseAdapter: unknown model "${table}"`);
    }
    return d;
  }

  async findOne<T = Document>(table: string, filter: Filter): Promise<T | null> {
    return (await this.delegate(table).findFirst({ where: filter })) as T | null;
  }

  async findMany<T = Document>(
    table: string,
    filter: Filter,
    opts?: { limit?: number; offset?: number; order?: [string, 'asc' | 'desc'] },
  ): Promise<T[]> {
    const orderBy = opts?.order ? { [opts.order[0]]: opts.order[1] } : undefined;
    return (await this.delegate(table).findMany({
      where: filter,
      take: opts?.limit ?? 100,
      skip: opts?.offset ?? 0,
      orderBy,
    })) as T[];
  }

  async insert<T = Document>(table: string, doc: Document): Promise<T> {
    return (await this.delegate(table).create({ data: doc })) as T;
  }

  async update<T = Document>(table: string, filter: Filter, patch: Document): Promise<T[]> {
    const delegate = this.delegate(table);
    const result = await delegate.updateMany({ where: filter, data: patch });
    if (result.count === 0) return [];
    // Re-query by id (NOT the full filter, which may no longer match after
    // the patch changed a filter field — e.g., filter={id, status:'queued'}
    // + patch={status:'printing'} → the row is no longer status='queued').
    // Using just {id} finds the updated row correctly.
    const idFilter = filter.id ? { id: filter.id } : filter;
    return (await delegate.findMany({ where: idFilter })) as T[];
  }

  async delete(table: string, filter: Filter): Promise<number> {
    return (await this.delegate(table).deleteMany({ where: filter })).count;
  }

  async count(table: string, filter: Filter): Promise<number> {
    return this.delegate(table).count({ where: filter });
  }

  async transaction<T>(work: (tx: TxLike) => Promise<T>): Promise<T> {
    // NOTE on isolation: a fully ACID cross-table transaction would thread
    // the Prisma tx client into every repo call via DbCallOptions.tx (and an
    // AsyncLocalStorage to scope it). For the Phase-2 demo the work runs
    // against the root client; rollback() throws to abort the unit of work,
    // which is the common-case semantic callers depend on. Swapping in true
    // tx isolation is a concrete-internal change that doesn't touch the
    // interface or the repo signatures.
    return work({
      rollback: async () => {
        throw new Error('__ROLLBACK__');
      },
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

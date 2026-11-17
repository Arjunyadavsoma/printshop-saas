import type { DatabaseAdapter, Document, Filter, TxLike } from '@platform/core/interfaces';

/** In-memory DatabaseAdapter for tests and single-process dev. */
export class InMemoryDatabaseAdapter implements DatabaseAdapter {
  readonly provider = 'memory';
  private tables = new Map<string, Map<string, Document>>();

  private table(name: string): Map<string, Document> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private matches(row: Document, filter: Filter): boolean {
    return Object.entries(filter).every(([k, v]) => {
      // Prisma-style top-level `OR` operator: an array of sub-filters,
      // any one of which must match. Used by the public shops search
      // (ShopRepository.searchActive). The key is the literal string 'OR'.
      if (k === 'OR' && Array.isArray(v)) {
        return (v as Filter[]).some((sub) => this.matches(row, sub));
      }
      // Prisma-style top-level `AND` operator: every sub-filter must match.
      if (k === 'AND' && Array.isArray(v)) {
        return (v as Filter[]).every((sub) => this.matches(row, sub));
      }
      // Prisma-style top-level `NOT` operator: none of the sub-filters match.
      if (k === 'NOT' && Array.isArray(v)) {
        return !(v as Filter[]).some((sub) => this.matches(row, sub));
      }
      // Support Prisma-style operators: { in: [...] }, { not: x }, { lt/gt/lte/gte: n }
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const op = v as Record<string, unknown>;
        if ('in' in op && Array.isArray(op.in)) {
          return op.in.includes(row[k]);
        }
        if ('not' in op) {
          return row[k] !== op.not;
        }
        if ('lt' in op) {
          const rv = row[k];
          return typeof rv === 'number' && typeof op.lt === 'number' ? rv < op.lt : String(rv) < String(op.lt);
        }
        if ('lte' in op) {
          const rv = row[k];
          return typeof rv === 'number' && typeof op.lte === 'number' ? rv <= op.lte : String(rv) <= String(op.lte);
        }
        if ('gt' in op) {
          const rv = row[k];
          return typeof rv === 'number' && typeof op.gt === 'number' ? rv > op.gt : String(rv) > String(op.gt);
        }
        if ('gte' in op) {
          const rv = row[k];
          return typeof rv === 'number' && typeof op.gte === 'number' ? rv >= op.gte : String(rv) >= String(op.gte);
        }
        // Prisma-style substring match. `mode: 'insensitive'` makes it
        // case-insensitive (Postgres `ILIKE`); without `mode` it's a
        // case-sensitive substring test.
        if ('contains' in op) {
          const rv = row[k];
          if (rv === undefined || rv === null) return false;
          const needle = String(op.contains);
          const haystack = String(rv);
          const insensitive = op.mode === 'insensitive';
          return insensitive
            ? haystack.toLowerCase().includes(needle.toLowerCase())
            : haystack.includes(needle);
        }
        // Unknown operator object — treat as no-match (defensive).
        return false;
      }
      return row[k] === v;
    });
  }

  async findOne<T = Document>(table: string, filter: Filter): Promise<T | null> {
    const rows = Array.from(this.table(table).values());
    return (rows.find((r) => this.matches(r, filter)) as T | undefined) ?? null;
  }

  async findMany<T = Document>(
    table: string,
    filter: Filter,
    opts?: { limit?: number; offset?: number; order?: [string, 'asc' | 'desc'] },
  ): Promise<T[]> {
    let rows = Array.from(this.table(table).values()).filter((r) => this.matches(r, filter));
    if (opts?.order) {
      const [col, dir] = opts.order;
      rows.sort((a, b) => {
        const av = (a[col] as number | string | undefined) ?? 0;
        const bv = (b[col] as number | string | undefined) ?? 0;
        return dir === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
      });
    }
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    return rows.slice(offset, offset + limit) as T[];
  }

  async insert<T = Document>(table: string, doc: Document): Promise<T> {
    const t = this.table(table);
    const id = (doc.id as string) ?? crypto.randomUUID();
    const stored = { ...doc, id };
    t.set(id, stored);
    return stored as T;
  }

  async update<T = Document>(table: string, filter: Filter, patch: Document): Promise<T[]> {
    const t = this.table(table);
    const updated: T[] = [];
    for (const [id, row] of t) {
      if (this.matches(row, filter)) {
        const next = { ...row, ...patch, id, updatedAt: new Date() };
        t.set(id, next);
        updated.push(next as T);
      }
    }
    return updated;
  }

  async delete(table: string, filter: Filter): Promise<number> {
    const t = this.table(table);
    let n = 0;
    for (const [id, row] of Array.from(t)) {
      if (this.matches(row, filter)) {
        t.delete(id);
        n++;
      }
    }
    return n;
  }

  async count(table: string, filter: Filter): Promise<number> {
    return Array.from(this.table(table).values()).filter((r) => this.matches(r, filter)).length;
  }

  async transaction<T>(work: (tx: TxLike) => Promise<T>): Promise<T> {
    // Snapshot for rollback. Cheap and correct for an in-memory store.
    const snapshot = new Map<string, Map<string, Document>>();
    for (const [name, rows] of this.tables) {
      snapshot.set(name, new Map(rows));
    }
    const tx: TxLike = {
      rollback: async () => {
        this.tables = snapshot;
      },
    };
    try {
      return await work(tx);
    } catch (err) {
      this.tables = snapshot;
      throw err;
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

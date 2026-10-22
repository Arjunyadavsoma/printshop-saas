import type { DatabaseAdapter, Document, Filter, TxLike } from '@platform/core/interfaces';

/**
 * In-memory DatabaseAdapter that ENFORCES unique constraints — used by the
 * order-token concurrency test to exercise the retry-on-P2002 path without
 * needing a real PostgreSQL/SQLite server.
 *
 * The behaviour mimics Prisma's P2002 (unique constraint violation) on INSERT
 * and UPDATE: if the row's value for any registered unique-key set already
 * exists in the table (and is non-null), the operation throws an error with
 * `code: 'P2002'` and `meta.target: <field[]>`, exactly like Prisma's
 * PrismaClientKnownRequestError.
 *
 * NULL semantics match PostgreSQL: a NULL value in a unique key is treated
 * as distinct, so multiple rows with NULL tokenNumber are allowed (this is
 * the contract the order-token allocation relies on for the legacy-order
 * fallback and the exhausted-retry fallback).
 *
 * The implementation is intentionally simple — it's a test fixture, not a
 * production DB. Single-threaded JavaScript means "concurrency" here is
 * actually interleaved async operations, which is exactly the failure mode
 * the order-token allocation has to defend against (count-then-insert where
 * two awaits interleave between the count and the insert).
 */
export class ConstrainedInMemoryDatabaseAdapter implements DatabaseAdapter {
  readonly provider = 'memory';
  private tables = new Map<string, Map<string, Document>>();
  private uniques = new Map<string, string[][]>(); // table -> list of unique field tuples

  /** Register a unique constraint on a tuple of fields for a table. */
  addUnique(table: string, fields: string[]): void {
    const key = table;
    const list = this.uniques.get(key) ?? [];
    list.push(fields);
    this.uniques.set(key, list);
  }

  private table(name: string): Map<string, Document> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private matches(row: Document, filter: Filter): boolean {
    return Object.entries(filter).every(([k, v]) => row[k] === v);
  }

  /**
   * Check whether `doc` would violate any registered unique constraint on
   * `table`, considering all existing rows EXCEPT the one with id `exceptId`
   * (used for updates). Returns the first violated field tuple, or null.
   */
  private findViolatedUnique(
    table: string,
    doc: Document,
    exceptId?: string,
  ): string[] | null {
    const constraints = this.uniques.get(table) ?? [];
    const rows = Array.from(this.table(table).entries()).filter(
      ([id]) => id !== exceptId,
    );
    for (const fields of constraints) {
      // NULL semantics: if any field in the tuple is null/undefined, this
      // constraint does not apply (matches PostgreSQL NULLs-are-distinct).
      if (fields.some((f) => doc[f] === null || doc[f] === undefined)) continue;
      for (const [, row] of rows) {
        if (fields.some((f) => row[f] === null || row[f] === undefined)) continue;
        const allMatch = fields.every((f) => row[f] === doc[f]);
        if (allMatch) return fields;
      }
    }
    return null;
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
    // Enforce unique constraints BEFORE inserting.
    const violated = this.findViolatedUnique(table, doc);
    if (violated) {
      throw makeP2002Error(table, violated);
    }
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
        // Enforce unique constraints considering all OTHER rows.
        const violated = this.findViolatedUnique(table, next, id);
        if (violated) {
          throw makeP2002Error(table, violated);
        }
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
    // Snapshot for rollback.
    const snapshot = new Map<string, Map<string, Document>>();
    for (const [name, rows] of this.tables) {
      snapshot.set(name, new Map(rows));
    }
    const snapshotUniques = new Map<string, string[][]>();
    for (const [name, lists] of this.uniques) {
      snapshotUniques.set(name, lists.map((l) => [...l]));
    }
    const tx: TxLike = {
      rollback: async () => {
        this.tables = snapshot;
        this.uniques = snapshotUniques;
      },
    };
    try {
      return await work(tx);
    } catch (err) {
      this.tables = snapshot;
      this.uniques = snapshotUniques;
      throw err;
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

/**
 * Construct an error shaped like Prisma's PrismaClientKnownRequestError for
 * P2002 (unique constraint violation), with `code` and `meta.target` so the
 * `uniqueViolationFields` helper in errors.ts can extract the field names.
 */
function makeP2002Error(table: string, fields: string[]): Error {
  const err: Error & { code?: string; meta?: { target?: string[] } } = new Error(
    `Unique constraint failed on the fields: (${fields.join(', ')})`,
  );
  err.name = 'PrismaClientKnownRequestError';
  err.code = 'P2002';
  err.meta = { target: fields };
  // Stash the table name so the test can introspect if needed.
  (err as unknown as { table?: string }).table = table;
  return err;
}

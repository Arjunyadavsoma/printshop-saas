import type { DatabaseAdapter, Document, Filter } from '@platform/core/interfaces';

/**
 * Base repository — the ONLY layer that calls into the {@link DatabaseAdapter}.
 * Routes and services depend on the typed per-model repositories, never on the
 * adapter directly. This is the structural guarantee that every query is
 * parameterised (no SQL injection) and tenant-scoped.
 */
export class BaseRepository<T extends Record<string, unknown>> {
  constructor(
    protected readonly adapter: DatabaseAdapter,
    protected readonly table: string,
  ) {}

  protected async findOne(filter: Filter): Promise<T | null> {
    return this.adapter.findOne<T>(this.table, filter);
  }

  protected async findMany(
    filter: Filter,
    opts?: { limit?: number; offset?: number; order?: [string, 'asc' | 'desc'] },
  ): Promise<T[]> {
    return this.adapter.findMany<T>(this.table, filter, opts);
  }

  protected async insertOne(data: T): Promise<T> {
    return this.adapter.insert<T>(this.table, data as unknown as Document);
  }

  protected async updateWhere(filter: Filter, patch: Partial<T>): Promise<T[]> {
    return this.adapter.update<T>(this.table, filter, patch as unknown as Document);
  }

  protected async deleteWhere(filter: Filter): Promise<number> {
    return this.adapter.delete(this.table, filter);
  }

  protected async countWhere(filter: Filter): Promise<number> {
    return this.adapter.count(this.table, filter);
  }

  /** Parse a JSON-string column defensively; returns `{}` on null/garbage. */
  protected parseJson(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string') return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** Stringify an object for a JSON-string column; `null` if empty. */
  protected stringifyJson(value: Record<string, unknown>): string {
    return JSON.stringify(value);
  }
}

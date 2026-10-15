import type { SubscriptionTier } from '../domain';

/**
 * Minimal CRUD-ish interface over a tabular data store.
 *
 * Concrete implementations ship in `packages/adapters`:
 *  - {@link SupabaseDatabaseAdapter} (free tier, Postgres)
 *  - {@link PostgresDatabaseAdapter} (self-hosted / Neon)
 *  - {@link InMemoryDatabaseAdapter} (tests)
 *
 * The business layer **never** constructs SQL itself — it goes through a
 * repository that wraps this interface. Swapping Supabase for Neon is a
 * one-line `DATABASE_PROVIDER` change.
 */

/** Generic equality filter handed to {@link DatabaseAdapter.findOne}. */
export type Filter = Record<string, unknown>;

/** Column → value overrides for {@link DatabaseAdapter.update} / `insert`. */
export type Document = Record<string, unknown>;

/** A row that supports transactions. */
export interface TxLike {
  /** Roll the transaction back and discard all writes. */
  rollback(): Promise<void>;
}

/** Options bag accepted by every mutating call. */
export interface DbCallOptions {
  /** Run inside an existing transaction handle. */
  tx?: TxLike;
}

/**
 * @public
 * The single contract every database provider must satisfy.
 */
export interface DatabaseAdapter {
  /** Human-readable id used in logs and config, e.g. "supabase". */
  readonly provider: string;

  /** Fetch a single row by table + filter, or `null` when absent. */
  findOne<T = Document>(
    table: string,
    filter: Filter,
    options?: DbCallOptions,
  ): Promise<T | null>;

  /** Fetch many rows; `limit` defaults to 100, `order` is `[column, dir]`. */
  findMany<T = Document>(
    table: string,
    filter: Filter,
    options?: { limit?: number; offset?: number; order?: [string, 'asc' | 'desc'] } & DbCallOptions,
  ): Promise<T[]>;

  /** Insert one row and return the stored representation. */
  insert<T = Document>(table: string, doc: Document, options?: DbCallOptions): Promise<T>;

  /** Update all rows matching `filter`; returns the updated rows. */
  update<T = Document>(
    table: string,
    filter: Filter,
    patch: Document,
    options?: DbCallOptions,
  ): Promise<T[]>;

  /** Delete rows matching `filter`; returns the count removed. */
  delete(table: string, filter: Filter, options?: DbCallOptions): Promise<number>;

  /** Count rows matching `filter`. */
  count(table: string, filter: Filter, options?: DbCallOptions): Promise<number>;

  /** Run a unit of work inside a transaction; commit on resolve, rollback on throw. */
  transaction<T>(work: (tx: TxLike) => Promise<T>): Promise<T>;

  /** Optional health probe used by `/ready`. */
  ping(): Promise<boolean>;
}

/** Shared context that flows into every adapter — typically tenant-scoped. */
export interface AdapterContext {
  shopId?: string;
  subscriptionTier?: SubscriptionTier;
  requestId?: string;
}

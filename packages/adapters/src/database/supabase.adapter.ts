import type { DatabaseAdapter } from '@platform/core/interfaces';

/**
 * Supabase Postgres adapter (free 500MB).
 *
 * PHASE-1 STATUS: skeleton — interface complete, runtime wiring lands in
 * Phase 2 when the Fastify app + Drizzle layer is built. The shape below is
 * the contract every method must satisfy; swapping this for a self-hosted
 * Postgres implementation is a one-line `DATABASE_PROVIDER=postgres` change
 * (see ARCHITECTURE.md).
 */
export class SupabaseDatabaseAdapter implements DatabaseAdapter {
  readonly provider = 'supabase';
  constructor(private readonly config: { url: string; anonKey: string; serviceRoleKey: string }) {}

  async findOne(): Promise<null> {
    throw new Error('SupabaseDatabaseAdapter: not implemented until Phase 2');
  }
  async findMany(): Promise<never[]> {
    return [];
  }
  async insert(): Promise<never> {
    throw new Error('SupabaseDatabaseAdapter: not implemented until Phase 2');
  }
  async update(): Promise<never[]> {
    return [];
  }
  async delete(): Promise<number> {
    return 0;
  }
  async count(): Promise<number> {
    return 0;
  }
  async transaction<T>(): Promise<T> {
    throw new Error('SupabaseDatabaseAdapter: not implemented until Phase 2');
  }
  async ping(): Promise<boolean> {
    return false;
  }
}

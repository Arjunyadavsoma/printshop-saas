/**
 * @platform/core
 *
 * Domain models, adapter interfaces, and the pure pricing engine for the
 * PrintShop SaaS. This package has **zero runtime dependencies on any
 * concrete adapter** — it is the single source of truth for business rules.
 *
 * See {@link packages/core/README.md} for the adapter-pattern rationale and a
 * worked example of swapping Supabase → self-hosted Postgres.
 */

// Domain models + Zod schemas
export * from './domain';
// Adapter interfaces (contracts only — concretes live in packages/adapters)
export * from './interfaces';
// Pure pricing engine
export * from './pricing';
// Error hierarchy
export * from './errors';

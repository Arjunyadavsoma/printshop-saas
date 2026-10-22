/**
 * Detect a unique-constraint violation across the supported DB drivers:
 *   - Prisma Client (P2002)
 *   - node-postgres / `pg` (SQLSTATE 23505)
 *   - better-sqlite3 / SQLite native (SQLITE_CONSTRAINT_UNIQUE, message text)
 *   - Supabase / PostgREST (code '23505' or message text)
 *
 * The repository layer throws whatever the underlying adapter throws. The
 * route layer catches, inspects this helper, and decides whether to retry
 * (a race-safe allocation loop) or rethrow (a real failure).
 */
export function isUniqueConstraintError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; name?: string; message?: string };
  // Prisma P2002 = unique constraint violation
  if (err.code === 'P2002') return true;
  // PrismaClientKnownRequestError carries `code` on the instance.
  if (err.name === 'PrismaClientKnownRequestError' && err.code === 'P2002') return true;
  // PostgreSQL SQLSTATE 23505 = unique_violation
  if (err.code === '23505') return true;
  // SQLite: better-sqlite3 throws SqliteError with code SQLITE_CONSTRAINT_UNIQUE
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (err.code === 'SQLITE_CONSTRAINT') {
    // The bare SQLITE_CONSTRAINT code covers PK/FOREIGN/UNIQUE — inspect the message.
    if (typeof err.message === 'string' && /unique/i.test(err.message)) return true;
  }
  // Fallback: check the message text — some adapters surface only that.
  if (typeof err.message === 'string') {
    return (
      /unique constraint/i.test(err.message) ||
      /duplicate key/i.test(err.message) ||
      /UNIQUE constraint failed/i.test(err.message)
    );
  }
  return false;
}

/**
 * Extract the target field names from a Prisma P2002 error (if available).
 * Returns an empty array if the error isn't a P2002 with `meta.target`.
 *
 * Used by the order-token allocation loop to decide whether to retry the
 * INSERT with a different candidate (only retry if the violation was on
 * `tokenNumber`, not e.g. on `customerToken`).
 */
export function uniqueViolationFields(e: unknown): string[] {
  if (!e || typeof e !== 'object') return [];
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return [];
  const target = err.meta?.target;
  if (!Array.isArray(target)) return [];
  return target.filter((x): x is string => typeof x === 'string');
}

/**
 * Detect a unique-constraint violation from Prisma (P2002) or the raw
 * PostgreSQL driver (code 23505). Used by the idempotent enqueue pattern
 * (enqueueFilePrint) to handle the concurrent-INSERT race on the partial
 * unique index `PrintJob_active_file_unique`.
 *
 * Extracted from src/lib/payments/webhook.service.ts so both the webhook
 * path + the manual /start path can share the same two-layer idempotency
 * guard (ARCH-003 fix).
 */
export function isUniqueConstraintError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string };
  // Prisma P2002 = unique constraint violation
  if (err.code === 'P2002') return true;
  // PostgreSQL SQLSTATE 23505 = unique_violation
  if (err.code === '23505') return true;
  // Fallback: check the message (some adapters surface it as a string)
  if (typeof err.message === 'string') {
    return /unique constraint|duplicate key|already exists/i.test(err.message);
  }
  return false;
}

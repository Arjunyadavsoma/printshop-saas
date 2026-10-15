/**
 * Date helpers. Kept dependency-free (no dayjs / date-fns) so this package
 * stays tiny and tree-shakeable.
 */

/** @returns the current ISO timestamp string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * @param seconds - TTL
 * @returns a Date `seconds` in the future.
 */
export function expiryFromNow(seconds: number): Date {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`expiryFromNow: seconds must be non-negative finite, got ${seconds}`);
  }
  return new Date(Date.now() + seconds * 1000);
}

/**
 * @param date - the date to test
 * @returns true if `date` is in the past (or null/undefined).
 */
export function isExpired(date: Date | null | undefined): boolean {
  if (!date) return true;
  return date.getTime() <= Date.now();
}

/** Generate a UUID v4 using the Web Crypto API (works in Node 20+ and browsers). */
export function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Generate a short, customer-friendly order token. Uses an unambiguous
 * alphabet (no 0/O/1/I) so it's read over the phone without confusion.
 * Default 6 chars → ~31 bits of entropy, plenty for per-shop uniqueness.
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateOrderToken(length = 6): string {
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new Error(`generateOrderToken: length must be 4-8, got ${length}`);
  }
  let out = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    out += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return out;
}

/**
 * A safe-ish, opaque storage key for an uploaded file.
 * Not a security boundary — just structured and unguessable.
 */
export function storageKey(shopId: string, orderId: string, fileId: string): string {
  return `shops/${shopId}/orders/${orderId}/${fileId}`;
}

/**
 * Generate a human-friendly per-shop sequential token (e.g. "A104", "B205").
 *
 * The token is `<letter><3-digit-number>` where:
 *   - sequences 1..999   → A001..A999
 *   - sequences 1000..1998 → B001..B999   (the letter rolls over after 999)
 *   - sequences 1999..2997 → C001..C999
 *   - and so on through Z, then AA, AB, ... (26 * 999 = 25,974 orders per
 *     shop before we hit two-letter prefixes — plenty for any shop).
 *
 * This format is the one the spec calls for ("A104", "B205"): short enough
 * to read out over the phone, sequential so the shopkeeper can call
 * "order A105" aloud, and the letter gives a high-level bucket when the
 * sequence rolls past 999.
 *
 * @param sequence - 1-based per-shop order sequence number (count of prior
 *                   orders + 1 is a reasonable starting point; the caller
 *                   is responsible for any retry on collision).
 */
export function generateShopOrderTokenNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`generateShopOrderTokenNumber: sequence must be a positive integer, got ${sequence}`);
  }
  // Each letter "bucket" holds 999 numbers (1..999, then 001..999 again, etc.).
  const BUCKET = 999;
  const bucketIndex = Math.floor((sequence - 1) / BUCKET); // 0-based
  const within = ((sequence - 1) % BUCKET) + 1;            // 1..999
  const letters = letterPrefix(bucketIndex);
  return `${letters}${String(within).padStart(3, '0')}`;
}

/** Encode the bucket index as A, B, ..., Z, AA, AB, ..., ZZ, AAA, ... */
function letterPrefix(index: number): string {
  const A = 'A'.charCodeAt(0);
  // Bijective base-26 (no zero digit — A=1..Z=26, AA=27..AZ=52, BA=53..).
  let n = index + 1; // 1-based
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(A + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}


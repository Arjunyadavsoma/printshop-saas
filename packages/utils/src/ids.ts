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

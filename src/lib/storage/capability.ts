import { createHmac, timingSafeEqual } from 'node:crypto';
import { getContainer } from '@/lib/container';

/**
 * Storage capability signing — the in-memory storage path's equivalent of an
 * R2/S3 presigned URL signature. The upload-url / download-url routes sign
 * the (key, method, expiry) tuple with an HMAC; the /storage/put + /storage/get
 * routes verify it. This prevents arbitrary-key reads/overwrites: an attacker
 * who can guess a key path still can't read or write without a valid, unexpired
 * signature.
 *
 * In production (R2/S3) the storage provider signs its own presigned URLs;
 * this code path only runs for the in-memory adapter.
 */
const CAPABILITY_SECRET = process.env.STORAGE_CAPABILITY_SECRET ?? 'dev-storage-capability-secret';

/** Sign a storage capability. Returns the signature (hex). */
export function signCapability(key: string, method: 'PUT' | 'GET', expiresAt: number): string {
  return createHmac('sha256', CAPABILITY_SECRET).update(`${method}|${key}|${expiresAt}`).digest('hex');
}

/** Build a signed query string for a storage URL. */
export function signedParams(key: string, method: 'PUT' | 'GET', expiresInSeconds: number): URLSearchParams {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sig = signCapability(key, method, exp);
  return new URLSearchParams({ key, exp: String(exp), sig });
}

/**
 * Verify a storage capability from query params. Returns the key if valid,
 * null otherwise. Checks: signature (constant-time), expiry, key format.
 *
 * Two key formats are accepted:
 *   1. Customer file uploads:  shops/<shopId>/orders/<orderId>/<fileId>
 *   2. Shop UPI QR images:      shops/<shopId>/upi-qr/<slug>.<ext>
 *      (set by the shopkeeper via POST /api/v1/shops/me/upi-qr)
 */
export function verifyCapability(params: URLSearchParams, method: 'PUT' | 'GET'): string | null {
  const key = params.get('key');
  const expStr = params.get('exp');
  const sig = params.get('sig');
  if (!key || !expStr || !sig) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() / 1000 > exp) return null;

  const expected = signCapability(key, method, exp);
  // Constant-time compare with unequal-length handling.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Validate the key format: either a customer-file key or a shop UPI-QR key.
  const isFileKey = /^shops\/[a-f0-9-]+\/orders\/[a-f0-9-]+\/[a-f0-9-]+$/.test(key);
  const isUpiQrKey = /^shops\/[a-f0-9-]+\/upi-qr\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/i.test(key);
  if (!isFileKey && !isUpiQrKey) return null;

  return key;
}

/** The max upload size (25 MB) — enforced on the /storage/put route. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

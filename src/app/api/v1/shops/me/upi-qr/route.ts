import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { getContainer } from '@/lib/container';
import { ValidationError, NotFoundError, AdapterError } from '@platform/core/errors';

/**
 * Shop UPI QR image upload + fetch.
 *
 *   POST /api/v1/shops/me/upi-qr   — upload a UPI QR image (PNG/JPEG/WebP, ≤5MB).
 *                                    Accepts multipart/form-data (`file` field)
 *                                    OR JSON `{ image: "<base64>", mimeType }`.
 *                                    Stores bytes in object storage, saves the
 *                                    storage key on `Shop.upiQrStorageKey`,
 *                                    returns a short-lived presigned download URL.
 *
 *   GET  /api/v1/shops/me/upi-qr   — mint a fresh short-lived presigned download
 *                                    URL for the current UPI QR image. 404 if no
 *                                    image is set.
 *
 * The image is stored at `shops/<shopId>/upi-qr/<uuid>.<ext>` — a private object
 * (NOT publicly listable) reachable only via a signed capability. This keeps
 * the shopkeeper's UPI VPA out of public access — only the shopkeeper and
 * customers they show the QR to can see it.
 */
const MAX_QR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** JSON-base64 fallback schema (used when Content-Type is application/json). */
const Base64Schema = z.object({
  image: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});

export const POST = withAuth(async (req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  const container = getContainer();

  // ── Extract bytes + MIME type from the request body. ──
  let bytes: Uint8Array;
  let mimeType: string;

  const ct = req.headers.get('content-type') ?? '';
  if (ct.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ValidationError('multipart/form-data request must include a `file` field', {
        expected: 'File',
      });
    }
    mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new ValidationError(`Unsupported image type: ${mimeType}`, {
        allowed: [...ALLOWED_MIME],
      });
    }
    if (file.size > MAX_QR_BYTES) {
      throw new ValidationError(`Image too large: ${file.size} bytes (max ${MAX_QR_BYTES})`, {
        maxBytes: MAX_QR_BYTES,
      });
    }
    const buf = await file.arrayBuffer();
    bytes = new Uint8Array(buf);
  } else {
    // JSON base64 fallback (curl-friendly for tests).
    const body = Base64Schema.parse(await req.json());
    mimeType = body.mimeType;
    let b64 = body.image;
    // Strip the optional `data:<mime>;base64,` prefix.
    const dataPrefix = `data:${mimeType};base64,`;
    if (b64.startsWith(dataPrefix)) b64 = b64.slice(dataPrefix.length);
    try {
      const buf = Buffer.from(b64, 'base64');
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      throw new ValidationError('Invalid base64 image payload');
    }
    if (bytes.byteLength > MAX_QR_BYTES) {
      throw new ValidationError(
        `Image too large: ${bytes.byteLength} bytes (max ${MAX_QR_BYTES})`,
        { maxBytes: MAX_QR_BYTES },
      );
    }
  }

  // ── Upload to storage. The key includes the shop's id (so per-shop path
  // scoping is enforced) + a fresh uuid + the canonical extension. ──
  const ext = EXT_BY_MIME[mimeType] ?? 'png';
  const key = `shops/${shop.id}/upi-qr/${crypto.randomUUID()}.${ext}`;

  const storage = container.storage;
  if (typeof (storage as unknown as { put?: unknown }).put !== 'function') {
    // Should never happen — InMemory, Supabase, S3 and R2 adapters all
    // implement `put` (the in-process upload extension). The disabled
    // adapter does not — uploads are explicitly unavailable there.
    throw new AdapterError(
      storage.provider,
      'storage backend does not support server-side put — set STORAGE_PROVIDER=memory or supabase',
    );
  }
  await (storage as unknown as {
    put: (k: string, b: Uint8Array, c: string) => Promise<void>;
  }).put(key, bytes, mimeType);

  // ── Save the storage key on the shop (replace the previous one if any). ──
  const previousKey = shop.upiQrStorageKey;
  const updated = await repos.shops.update(shop.id, { upiQrStorageKey: key });

  // Best-effort: delete the previously-uploaded image so we don't accumulate
  // stale UPI QR blobs when the shopkeeper uploads a new one.
  if (previousKey && previousKey !== key) {
    try {
      await storage.delete(previousKey);
    } catch {
      // Non-fatal — keep the upload, drop the orphan. Cron cleans these up.
    }
  }

  // ── Mint a short-lived presigned download URL (15 min). ──
  const downloadUrl = await storage.getPresignedDownloadUrl(key, 900);

  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'shop.upi-qr.upload',
    entityType: 'shop',
    entityId: shop.id,
    metadata: { storageKey: key, mimeType, sizeBytes: bytes.byteLength },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  return ok({
    upiQrStorageKey: updated.upiQrStorageKey,
    downloadUrl,
    expiresIn: 900,
    mimeType,
    sizeBytes: bytes.byteLength,
  });
});

export const GET = withAuth(async (_req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  if (!shop.upiQrStorageKey) {
    throw new NotFoundError('No UPI QR image uploaded yet');
  }
  const downloadUrl = await getContainer().storage.getPresignedDownloadUrl(
    shop.upiQrStorageKey,
    900,
  );
  return ok({
    upiQrStorageKey: shop.upiQrStorageKey,
    downloadUrl,
    expiresIn: 900,
  });
});

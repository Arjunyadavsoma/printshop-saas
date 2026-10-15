import { type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { verifyCapability, MAX_UPLOAD_BYTES } from '@/lib/storage/capability';
import { requireDev } from '@/lib/api/require-dev';

/**
 * PUT /api/v1/storage/put — in-process upload receiver. Verifies a signed
 * storage capability (HMAC + expiry + key-format) before accepting bytes,
 * and enforces a 25 MB body limit. In production this route does NOT exist:
 * the presigned URL points directly at R2/S3.
 */
export async function PUT(req: NextRequest): Promise<Response> {
  try {
    const guard = requireDev();
    if (guard) return guard;
    // Verify the signed capability (prevents arbitrary-key overwrites).
    const key = verifyCapability(req.nextUrl.searchParams, 'PUT');
    if (!key) return fail(toAppError(new Error('invalid or expired upload capability')));

    const ct = req.nextUrl.searchParams.get('ct') ?? 'application/octet-stream';

    // Read the body with a size limit (prevents memory exhaustion).
    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return fail(toAppError(new Error(`upload too large (max ${MAX_UPLOAD_BYTES} bytes)`)));
    }
    const buf = await req.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return fail(toAppError(new Error(`upload too large (max ${MAX_UPLOAD_BYTES} bytes)`)));
    }

    const storage = getContainer().storage;
    if (typeof (storage as unknown as { put?: unknown }).put !== 'function') {
      return fail(toAppError(new Error('storage backend does not support direct put')));
    }
    await (storage as unknown as { put: (k: string, b: Uint8Array, c: string) => Promise<void> }).put(key, bytes, ct);
    return ok({ key, size: bytes.length });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}

import { type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';

/**
 * PUT /api/v1/storage/put — in-process upload receiver for the in-memory
 * storage adapter. In production this route does NOT exist: the presigned URL
 * points directly at R2/S3 and the API server never sees the bytes. It exists
 * here so the full upload→confirm→parse→print flow works without a cloud
 * bucket.
 */
export async function PUT(req: NextRequest): Promise<Response> {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    const ct = url.searchParams.get('ct') ?? 'application/octet-stream';
    if (!key) return fail(toAppError(new Error('missing key')));
    const bytes = new Uint8Array(await req.arrayBuffer());
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

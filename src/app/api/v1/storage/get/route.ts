import { NextResponse, type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { fail, toAppError } from '@/lib/api/envelope';
import { verifyCapability } from '@/lib/storage/capability';
import { requireDev } from '@/lib/api/require-dev';

/**
 * GET /api/v1/storage/get?key=...&exp=...&sig=... — download bytes. Verifies a
 * signed storage capability (HMAC + expiry + key-format) before serving. In
 * production this route does NOT exist: the presigned download URL points
 * directly at R2/S3.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const guard = requireDev();
    if (guard) return guard;
    const key = verifyCapability(req.nextUrl.searchParams, 'GET');
    if (!key) return fail(toAppError(new Error('invalid or expired download capability')));

    const storage = getContainer().storage;
    if (typeof (storage as unknown as { getBytes?: unknown }).getBytes !== 'function') {
      return fail(toAppError(new Error('storage backend does not support direct get')));
    }
    const obj = await (storage as unknown as { getBytes: (k: string) => Promise<{ bytes: Uint8Array; contentType: string } | null> }).getBytes(key);
    if (!obj) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'object not found (auto-deleted?)' } }, { status: 404 });
    }
    return new NextResponse(obj.bytes as unknown as BodyInit, { headers: { 'Content-Type': obj.contentType, 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}

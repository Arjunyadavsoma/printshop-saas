import { NextResponse, type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { fail, toAppError } from '@/lib/api/envelope';

/**
 * GET /api/v1/storage/get?key=... — download bytes from the in-memory store.
 *
 * In production this route does NOT exist: the presigned download URL points
 * directly at R2/S3. It exists here so the print-agent daemon (a separate
 * process) can fetch the file bytes through the gateway during the demo.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const key = req.nextUrl.searchParams.get('key');
    if (!key) return fail(toAppError(new Error('missing key')));
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

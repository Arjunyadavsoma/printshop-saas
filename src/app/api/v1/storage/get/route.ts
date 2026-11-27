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
 *
 * Caching: thumbnails and original uploads are immutable (the bytes never
 * change for a given key — a new upload gets a new fileId → new key). So
 * we cache them aggressively (public, max-age=3600). This eliminates
 * redundant round-trips when the checkout page shows the same thumbnail
 * multiple times (preview, cart, order summary).
 *
 * Status codes:
 *   200 — bytes served
 *   403 — invalid/expired capability signature (NOT 500 — this is an auth
 *         failure, not a server error. Returning 500 made it look like a
 *         server bug in logs + monitoring.)
 *   404 — key is valid but object not found (auto-deleted / never stored)
 *   500 — unexpected server error (storage backend threw)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const guard = requireDev();
    if (guard) return guard;
    const key = verifyCapability(req.nextUrl.searchParams, 'GET');
    if (!key) {
      // 403, not 500 — this is an auth failure (bad signature / expired).
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'invalid or expired download capability' } },
        { status: 403 },
      );
    }

    const storage = getContainer().storage;
    if (typeof (storage as unknown as { getBytes?: unknown }).getBytes !== 'function') {
      return fail(toAppError(new Error('storage backend does not support direct get')));
    }
    const obj = await (storage as unknown as { getBytes: (k: string) => Promise<{ bytes: Uint8Array; contentType: string } | null> }).getBytes(key);
    if (!obj) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'object not found (auto-deleted?)' } },
        { status: 404 },
      );
    }
    // Immutable content — cache aggressively. Thumbnails + originals never
    // change for a given key (new upload → new fileId → new key).
    return new NextResponse(obj.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': obj.contentType,
        'Cache-Control': 'public, max-age=3600, immutable',
      },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}

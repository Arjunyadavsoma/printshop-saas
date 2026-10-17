import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { requireDev } from '@/lib/api/require-dev';

/**
 * GET /api/v1/dev/qr?data=<urlencoded> — DEV-ONLY generic QR PNG data URL.
 *
 * DEPRECATED: use the production route at /api/v1/qr instead. This dev copy
 * is retained for backward compatibility with old demo links but is gated by
 * requireDev() (returns 404 in production). The customer checkout flow now
 * uses /api/v1/qr.
 */
export const GET = withRateLimit('qr', 60, 60, async (req, _ctx) => {
  const guard = requireDev();
  if (guard) return guard;
  try {
    const data = req.nextUrl.searchParams.get('data');
    if (!data) return fail(toAppError(new Error('missing ?data=')));
    const pngDataUrl = await QRCode.toDataURL(data, { margin: 1, width: 320 });
    return ok({ pngDataUrl });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

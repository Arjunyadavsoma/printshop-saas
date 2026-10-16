import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';

/**
 * GET /api/v1/dev/qr?data=<urlencoded> — generic QR PNG data URL.
 *
 * Used by the customer app to render a `upi://` payment payload as a scannable
 * QR on desktop (on mobile, the same payload opens the UPI app directly).
 */
export const GET = withRateLimit('qr', 60, 60, async (req, _ctx) => {
  try {
    const data = req.nextUrl.searchParams.get('data');
    if (!data) return fail(toAppError(new Error('missing ?data=')));
    const pngDataUrl = await QRCode.toDataURL(data, { margin: 1, width: 320 });
    return ok({ pngDataUrl });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

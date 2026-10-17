import { type NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';

/**
 * GET /api/v1/qr?data=<urlencoded> — generic QR PNG data URL.
 *
 * Production-legal QR generator (stateless, rate-limited, no DB, no secrets).
 * Used by the customer checkout flow to render a `upi://` payment payload as
 * a scannable QR on desktop. On mobile, the same payload opens the UPI app
 * directly. This route was previously under /dev/qr — moved here so it is
 * NOT gated by requireDev() (the customer flow needs it in production).
 */
export const GET = withRateLimit('qr', 60, 60, async (req: NextRequest) => {
  try {
    const data = req.nextUrl.searchParams.get('data');
    if (!data) return fail(toAppError(new Error('missing ?data=')));
    const pngDataUrl = await QRCode.toDataURL(data, { margin: 1, width: 320 });
    return ok({ pngDataUrl });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

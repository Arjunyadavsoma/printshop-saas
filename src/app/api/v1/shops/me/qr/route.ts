import { NextResponse, type NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { getShopCustomerUrl } from '@/lib/api/origin';

/**
 * GET /api/v1/shops/me/qr?format=png|svg&download=true|false
 *
 * The shop-ordering QR — encodes the shop's public URL so customers can scan
 * it to start an order. Distinct from the shopkeeper-uploaded UPI payment QR
 * (handled by /api/v1/shops/me/upi-qr).
 *
 *  ?format=png                → JSON envelope with a `pngDataUrl` (data: URL) — used by the settings page to render inline.
 *  ?format=svg&download=true   → raw SVG file (Content-Type: image/svg+xml, Content-Disposition: attachment) — used to download the QR for print.
 *  ?format=svg                 → JSON envelope with `svgString` + `pngDataUrl`.
 *
 * No persisted bytes — the QR is generated on demand from the public URL.
 *
 * The URL is derived from the REQUEST's host (via getShopCustomerUrl) so
 * the QR always uses the deployment the shopkeeper is currently on — if
 * the site moves to a new domain, the next QR generation (or refresh of
 * the settings page) uses the new domain automatically. Previously this
 * used process.env.APP_BASE_URL, which broke when the env var wasn't set
 * on a new deployment (the QR encoded http://localhost:3000/<slug> —
 * unreachable from a customer's phone).
 */
export const GET = withAuth(async (req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  const format = req.nextUrl.searchParams.get('format');
  const download = req.nextUrl.searchParams.get('download') === 'true';
  const customerUrl = getShopCustomerUrl(shop.slug, req);

  if (format === 'svg' && download) {
    const svgString = await QRCode.toString(customerUrl, { type: 'svg', margin: 2 });
    return new NextResponse(svgString, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Disposition': `attachment; filename="${shop.slug}-qr.svg"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (format === 'png') {
    const pngDataUrl = await QRCode.toDataURL(customerUrl, { margin: 2, width: 512 });
    return ok({ pngDataUrl, customerUrl, slug: shop.slug });
  }

  const svgString = await QRCode.toString(customerUrl, { type: 'svg', margin: 2 });
  const pngDataUrl = await QRCode.toDataURL(customerUrl, { margin: 2, width: 512 });
  return ok({ svgString, pngDataUrl, customerUrl, slug: shop.slug, shopName: shop.name });
});

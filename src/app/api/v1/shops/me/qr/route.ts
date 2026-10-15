import QRCode from 'qrcode';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

/** GET /api/v1/shops/me/qr?format=png|svg — QR PNG data URL + SVG + customer URL. */
export const GET = withAuth(async (req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  const format = req.nextUrl.searchParams.get('format');
  const customerUrl = `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/${shop.slug}`;

  if (format === 'png') {
    const pngDataUrl = await QRCode.toDataURL(customerUrl, { margin: 2, width: 512 });
    return ok({ pngDataUrl, customerUrl, slug: shop.slug });
  }

  const svgString = await QRCode.toString(customerUrl, { type: 'svg', margin: 2 });
  const pngDataUrl = await QRCode.toDataURL(customerUrl, { margin: 2, width: 512 });
  return ok({ svgString, pngDataUrl, customerUrl, slug: shop.slug, shopName: shop.name });
});

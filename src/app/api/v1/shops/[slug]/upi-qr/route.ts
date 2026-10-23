import { type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/shops/:slug/upi-qr — public endpoint that returns a short-lived
 * presigned download URL for the shopkeeper's uploaded UPI payment QR image.
 *
 * This is the DESKTOP QR fallback for customers who can't use mobile UPI deep
 * linking. The customer scans this QR with their UPI app to pay the exact
 * order amount.
 *
 * The QR image is stored at `shops/<shopId>/upi-qr/<uuid>.<ext>` in the
 * private Supabase bucket. The presigned URL is short-lived (15 min) so even
 * if it leaks, it expires quickly.
 *
 * Returns 404 (with `hasUpiQr: false`) if the shop has no uploaded UPI QR.
 * The customer UI should then fall back to showing the UPI ID as text +
 * instructions to enter it manually in their UPI app.
 *
 * SECURITY: This endpoint is PUBLIC (no auth). The UPI VPA (payee address)
 * is already public — it's shown on the shop page + embedded in the
 * `upi://pay?pa=...` URI. The QR image just encodes the same VPA. No
 * customer PII is exposed.
 */
export const GET = withRateLimit<{ slug: string }>('shop-upi-qr', 60, 60, async (_req: NextRequest, ctx) => {
  try {
    const { slug } = await ctx.params;
    const shop = await repos.shops.findBySlug(slug);
    if (!shop || !shop.isActive) throw new NotFoundError('Shop not found');
    if (!shop.upiQrStorageKey) {
      return ok({ hasUpiQr: false, upiQrUrl: null, upiId: shop.upiId, shopName: shop.name });
    }
    const downloadUrl = await getContainer().storage.getPresignedDownloadUrl(
      shop.upiQrStorageKey,
      900, // 15 minutes
    );
    return ok({
      hasUpiQr: true,
      upiQrUrl: downloadUrl,
      upiId: shop.upiId,
      shopName: shop.name,
      expiresIn: 900,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

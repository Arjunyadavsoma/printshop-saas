import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';

/** GET /api/v1/shops/:slug — public shop info + pricing (no auth). */
export const GET = withRateLimit('shop-info', 60, 60, async (_req, ctx) => {
  try {
    const { slug } = await ctx.params;
    const shop = await repos.shops.findBySlug(slug);
    if (!shop || !shop.isActive) throw new NotFoundError('Shop not found');
    return ok({
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      upiId: shop.upiId,
      paymentProvider: shop.paymentProvider,
      pricingConfig: shop.pricingConfig,
      timezone: shop.timezone,
      privacy: {
        filesPrivateByDefault: true,
        downloadUrlsExpireSeconds: 900,
        autoDeleteAfterCollectSeconds: 60,
        autoDeleteCronHours: 24,
      },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

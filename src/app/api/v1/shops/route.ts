import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';

/**
 * GET /api/v1/shops — public list of active shops for customer discovery.
 *
 * Returns a paginated list of active shops with their name, slug, address,
 * phone, pricing summary, and operational status. Does NOT expose payment
 * credentials, owner PII, or internal config.
 *
 * Query params:
 *   - q: search query (matches name or address, case-insensitive)
 *   - limit: page size (default 20, max 50)
 *   - offset: pagination offset (default 0)
 */
export const GET = withRateLimit('shops-list', 60, 60, async (req) => {
  try {
    const url = req.nextUrl;
    const q = (url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

    const allShops = await repos.shops.listActive(limit + 1, offset); // +1 to detect next page
    let filtered = allShops;
    if (q) {
      const ql = q.toLowerCase();
      filtered = allShops.filter(
        (s) => s.name.toLowerCase().includes(ql) || s.address.toLowerCase().includes(ql),
      );
    }

    const hasNext = filtered.length > limit;
    const page = hasNext ? filtered.slice(0, limit) : filtered;

    return ok({
      shops: page.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        address: s.address,
        phone: s.phone,
        upiId: s.upiId,
        paymentProvider: s.paymentProvider,
        subscriptionTier: s.subscriptionTier,
        isActive: s.isActive,
        createdAt: s.createdAt,
        // Pricing summary — base rate per page for bw + color
        pricingSummary: {
          bwA4PerPage: s.pricingConfig?.bw_a4_per_page ?? 200,
          colorA4PerPage: s.pricingConfig?.color_a4_per_page ?? 500,
          minOrderValue: s.pricingConfig?.min_order_value ?? 1000,
        },
      })),
      pagination: { limit, offset, hasNext, total: page.length },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

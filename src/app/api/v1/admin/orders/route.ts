import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

/**
 * GET /api/v1/admin/orders — list ALL orders across all shops (admin only).
 * Supports filtering by status, shopId, and pagination.
 */
export const GET = withAuth(async (req) => {
  const url = req.nextUrl;
  const status = url.searchParams.get('status') ?? undefined;
  const shopId = url.searchParams.get('shopId') ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;

  // If shopId is specified, use listByShop (tenant-scoped); otherwise listAll
  const orders = shopId
    ? await repos.orders.listByShop(shopId, { status: status as any, limit, offset })
    : await repos.orders.listAll({ status, limit, offset });

  // Enrich with shop names
  const shopCache = new Map<string, { name: string; slug: string }>();
  const enriched = await Promise.all(
    orders.map(async (o) => {
      if (!shopCache.has(o.shopId)) {
        const shop = await repos.shops.findById(o.shopId);
        if (shop) shopCache.set(o.shopId, { name: shop.name, slug: shop.slug });
      }
      const shopInfo = shopCache.get(o.shopId);
      return {
        id: o.id,
        shopId: o.shopId,
        shopName: shopInfo?.name ?? 'Unknown',
        shopSlug: shopInfo?.slug ?? '',
        customerToken: o.customerToken,
        status: o.status,
        totalAmountPaise: o.totalAmountPaise,
        currency: o.currency,
        paymentProvider: o.paymentProvider,
        paymentTxnId: o.paymentTxnId,
        paidAt: o.paidAt,
        customerPhone: o.customerPhone,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    }),
  );

  return ok({ orders: enriched, pagination: { limit, offset, total: enriched.length } });
}, ['admin']);

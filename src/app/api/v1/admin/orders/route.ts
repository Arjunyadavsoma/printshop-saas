import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

/**
 * GET /api/v1/admin/orders — list ALL orders across all shops (admin only).
 * Supports filtering by status, shopId, and pagination.
 *
 * ARCH-004 fix:
 *   - BATCH shop fetch: previously did N+1 sequential findById calls (one
 *     per order, with a shopCache mitigating the worst case but not the
 *     diversity). Now does a single findByIds([...]) query + looks up
 *     each order's shop from the Map.
 *   - REAL pagination total: previously returned `enriched.length` (the
 *     current page size) as `total`, so the UI couldn't tell if there was
 *     a next page. Now calls countAll(status) for the global total.
 */
export const GET = withAuth(async (req) => {
  const url = req.nextUrl;
  const status = url.searchParams.get('status') ?? undefined;
  const shopId = url.searchParams.get('shopId') ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;

  // If shopId is specified, use listByShop (tenant-scoped); otherwise listAll
  const orders = shopId
    ? await repos.orders.listByShop(shopId, { status: status as never, limit, offset })
    : await repos.orders.listAll({ status, limit, offset });

  // BATCH fetch all shops for the page's orders in a SINGLE query (was N+1).
  const shopsById = await repos.shops.findByIds(orders.map((o) => o.shopId));

  const enriched = orders.map((o) => {
    const shop = shopsById.get(o.shopId);
    return {
      id: o.id,
      shopId: o.shopId,
      shopName: shop?.name ?? 'Unknown',
      shopSlug: shop?.slug ?? '',
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
  });

  // REAL total — countAll with the same status filter (was returning the
  // current page size, so the UI couldn't tell if there was a next page).
  const total = shopId
    ? await repos.orders.countByShop(shopId, status as never)
    : await repos.orders.countAll(status);

  return ok({ orders: enriched, pagination: { limit, offset, total } });
}, ['admin']);

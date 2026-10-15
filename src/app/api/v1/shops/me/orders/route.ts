import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { ORDER_STATUSES, type OrderStatus } from '@platform/core/domain';
import { isOneOf } from '@platform/core/domain';

/** GET /api/v1/shops/me/orders — paginated, filterable list (?status=&limit=&offset=). */
export const GET = withAuth(
  async (req, _ctx, principal) => {
    const shop = await repos.shops.getByOwner(principal.userId);
    const q = req.nextUrl.searchParams;
    const limit = Math.min(Number(q.get('limit') ?? '50'), 200);
    const offset = Number(q.get('offset') ?? '0');
    const statusParam = q.get('status');
    const status = statusParam && isOneOf(statusParam, ORDER_STATUSES) ? (statusParam as OrderStatus) : undefined;

    const [orders, total] = await Promise.all([
      repos.orders.listByShop(shop.id, { status, limit, offset }),
      repos.orders.countByShop(shop.id, status),
    ]);

    return ok(orders, { pagination: { limit, offset, total } });
  },
);

import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { ORDER_STATUSES, type OrderStatus } from '@platform/core/domain';
import { isOneOf } from '@platform/core/domain';

/** GET /api/v1/shops/me/orders — paginated, filterable list. */
export const GET = withAuth<{ status?: string; limit?: string; offset?: string }>(
  async (req, _ctx, principal) => {
    const shop = await repos.shops.getByOwner(principal.userId);
    const sp = await _ctx.params;
    const limit = Math.min(Number(sp.limit ?? '50'), 200);
    const offset = Number(sp.offset ?? '0');
    const status = sp.status && isOneOf(sp.status, ORDER_STATUSES) ? (sp.status as OrderStatus) : undefined;

    const [orders, total] = await Promise.all([
      repos.orders.listByShop(shop.id, { status, limit, offset }),
      repos.orders.countByShop(shop.id, status),
    ]);

    return ok(orders, { pagination: { limit, offset, total } });
  },
);

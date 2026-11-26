import { type NextRequest } from 'next/server';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withCustomerAuth } from '@/lib/api/with-auth';

/**
 * GET /api/v1/customer/orders — the signed-in customer's order history
 * across all shops, newest first.
 *
 * Only orders placed while signed in appear here: an order gains a
 * `customerId` only when it is placed with a valid customer JWT (see
 * `placeOrder`). Guest orders have `customerId: null` and stay
 * device-local (localStorage recent orders + the per-order tracking
 * link) — signing in never exposes another customer's orders, and a
 * guest order is never retroactively attached to an account.
 *
 * Query: `?limit=` (default 50, max 100), `?offset=` (default 0).
 * Guarded by `withCustomerAuth` — the list is always scoped to the
 * token's customer id.
 */
export const GET = withCustomerAuth(async (req: NextRequest, _ctx, principal) => {
  try {
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(req.nextUrl.searchParams.get('offset') ?? 0) || 0, 0);
    const orders = await repos.orders.listByCustomer(principal.customerId, { limit, offset });
    const items = await Promise.all(
      orders.map(async (o) => {
        const shop = await repos.shops.findById(o.shopId);
        return {
          id: o.id,
          token: o.customerToken,
          orderNumber: o.tokenNumber,
          shopId: o.shopId,
          shopName: shop?.name ?? null,
          shopSlug: shop?.slug ?? null,
          status: o.status,
          totalAmountPaise: o.totalAmountPaise,
          placedAt: o.placedAt ?? o.createdAt,
          createdAt: o.createdAt,
        };
      }),
    );
    return ok({ orders: items, limit, offset });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

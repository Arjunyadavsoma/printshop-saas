import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { toPublic } from '@platform/core/domain';

/**
 * GET /api/v1/me/customer — the customer's profile + order history.
 *
 * Authorization: role='customer'. The principal's `userId` is the
 * CustomerAccount.id (the JWT was issued with role='customer' +
 * sub=accountId).
 *
 * Order history is across ALL shops the customer has ordered from —
 * customers are not shop-scoped. The query is by `customerAccountId`
 * (the indexed column added in Phase 4).
 *
 * Tenancy: the customer can read only their own account + their own
 * orders. The principal.userId IS the accountId; no shopkeeper can
 * pass a different shopId and read another shop's customers.
 */
export const GET = withAuth(async (_req, _ctx, principal) => {
  try {
    if (principal.role !== 'customer') {
      return fail(toAppError(new Error('Forbidden: customer role required')));
    }
    const accountId = principal.userId;

    const account = await repos.customerAccounts.findById(accountId);
    if (!account) {
      return fail(toAppError(new Error('Account not found')));
    }

    // List orders linked to this account. Phase 4 column
    // `Order.customerAccountId` is indexed for this query.
    const orders = await repos.orders.listByCustomerAccount(accountId, { limit: 100 });

    // Resolve shop names for the order list so the UI doesn't need a
    // second round-trip.
    const shopIds = [...new Set(orders.map((o) => o.shopId))];
    const shops = shopIds.length > 0 ? await repos.shops.findByIds(shopIds) : new Map();

    return ok({
      account: toPublic(account),
      orders: orders.map((o) => ({
        id: o.id,
        shopId: o.shopId,
        shopName: shops.get(o.shopId)?.name ?? 'Unknown',
        shopSlug: shops.get(o.shopId)?.slug ?? '',
        status: o.status,
        totalAmountPaise: o.totalAmountPaise,
        currency: o.currency,
        paidAt: o.paidAt,
        createdAt: o.createdAt,
      })),
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['customer']);

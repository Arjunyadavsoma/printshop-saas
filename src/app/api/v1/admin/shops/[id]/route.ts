import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/admin/shops/:id — full shop detail + order summary (admin only).
 */
export const GET = withAuth<{ id: string }>(async (_req, ctx) => {
  try {
    const { id } = await ctx.params;
    const shop = await repos.shops.findById(id);
    if (!shop) throw new NotFoundError('Shop not found');

    const orders = await repos.orders.listByShop(shop.id, { limit: 100 });
    const paidOrders = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'awaiting_payment');
    const revenuePaise = paidOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);
    const agents = await repos.printAgents.listByShop(shop.id);

    return ok({
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        upiId: shop.upiId,
        ownerUserId: shop.ownerUserId,
        paymentProvider: shop.paymentProvider,
        address: shop.address,
        phone: shop.phone,
        timezone: shop.timezone,
        isActive: shop.isActive,
        subscriptionTier: shop.subscriptionTier,
        subscriptionExpiresAt: shop.subscriptionExpiresAt,
        createdAt: shop.createdAt,
        updatedAt: shop.updatedAt,
        pricingConfig: shop.pricingConfig,
      },
      summary: {
        totalOrders: orders.length,
        paidOrders: paidOrders.length,
        revenuePaise,
        activeAgents: agents.filter((a) => a.isOnline).length,
        totalAgents: agents.length,
      },
      orders: orders.map((o) => ({
        id: o.id,
        customerToken: o.customerToken,
        status: o.status,
        totalAmountPaise: o.totalAmountPaise,
        paymentTxnId: o.paymentTxnId,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
      })),
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        isOnline: a.isOnline,
        lastSeenAt: a.lastSeenAt,
        printerName: a.printerName,
        version: a.version,
        os: a.os,
      })),
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['admin']);

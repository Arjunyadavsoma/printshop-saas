import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

/**
 * GET /api/v1/admin/shops — list ALL shops (active + inactive).
 * Admin-only. Does NOT expose payment credentials.
 *
 * Each row is enriched with:
 *   - ownerEmail (resolved from the users table)
 *   - orderCount + paidOrders + paidSalesPaise (from the orders table)
 *   - agentsOnline + agentsTotal (from the print_agents table)
 *
 * All monetary values are integer paise.
 */
export const GET = withAuth(async (req) => {
  const url = req.nextUrl;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;

  const shops = await repos.shops.listAll(limit, offset);
  const agents = await repos.printAgents.listAll();

  // Build per-shop aggregates in-memory to avoid N+1 queries.
  const agentsByShop = new Map<string, { online: number; total: number }>();
  for (const a of agents) {
    const slot = agentsByShop.get(a.shopId) ?? { online: 0, total: 0 };
    slot.total++;
    if (a.isOnline) slot.online++;
    agentsByShop.set(a.shopId, slot);
  }

  // Fetch all orders once and aggregate by shop (no N+1).
  const allOrders = await repos.orders.listAll({ limit: 500 });
  const ordersByShop = new Map<string, { count: number; paidOrders: number; paidSalesPaise: number }>();
  for (const o of allOrders) {
    const slot = ordersByShop.get(o.shopId) ?? { count: 0, paidOrders: 0, paidSalesPaise: 0 };
    slot.count++;
    if (o.status !== 'cancelled' && o.status !== 'awaiting_payment') {
      slot.paidOrders++;
      slot.paidSalesPaise += o.totalAmountPaise;
    }
    ordersByShop.set(o.shopId, slot);
  }

  // Resolve owner emails in a single batch (users.findById is per-id — there
  // are few enough owners in practice; the in-memory DB handles this fine).
  const ownerEmailCache = new Map<string, string>();
  await Promise.all(
    Array.from(new Set(shops.map((s) => s.ownerUserId))).map(async (uid) => {
      const u = await repos.users.findById(uid);
      ownerEmailCache.set(uid, u?.email ?? '—');
    }),
  );

  return ok({
    shops: shops.map((s) => {
      const ord = ordersByShop.get(s.id) ?? { count: 0, paidOrders: 0, paidSalesPaise: 0 };
      const ag = agentsByShop.get(s.id) ?? { online: 0, total: 0 };
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        upiId: s.upiId,
        ownerUserId: s.ownerUserId,
        ownerEmail: ownerEmailCache.get(s.ownerUserId) ?? '—',
        paymentProvider: s.paymentProvider,
        address: s.address,
        phone: s.phone,
        timezone: s.timezone,
        isActive: s.isActive,
        subscriptionTier: s.subscriptionTier,
        subscriptionExpiresAt: s.subscriptionExpiresAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        pricingSummaries: {
          bwA4PerPage: s.pricingConfig?.bw_a4_per_page ?? 200,
          colorA4PerPage: s.pricingConfig?.color_a4_per_page ?? 500,
          minOrderValue: s.pricingConfig?.min_order_value ?? 1000,
        },
        stats: {
          orderCount: ord.count,
          paidOrders: ord.paidOrders,
          paidSalesPaise: ord.paidSalesPaise,
          agentsOnline: ag.online,
          agentsTotal: ag.total,
        },
      };
    }),
    pagination: { limit, offset, total: shops.length },
  });
}, ['admin']);

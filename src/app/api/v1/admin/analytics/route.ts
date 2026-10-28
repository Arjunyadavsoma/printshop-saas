import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { ORDER_STATUSES, type OrderStatus } from '@platform/core/domain';

/**
 * GET /api/v1/admin/analytics — platform-wide metrics (admin only).
 *
 * Metrics are derived from persisted records using consistent definitions:
 * - grossPaidValuePaise = sum of totalAmountPaise for orders NOT in cancelled/awaiting_payment
 * - shopEarningsPaise = same as grossPaidValue (the platform charges no commission —
 *   the shopkeeper receives the full customer payment via UPI directly)
 * - platformRevenuePaise = 0 (no commission model in this product — documented)
 *
 * All amounts are integer paise. Never float.
 */
export const GET = withAuth(async (req) => {
  const url = req.nextUrl;
  // Optional date filter (ISO date string, e.g. 2026-10-22)
  const dateFilter = url.searchParams.get('date');

  const allShops = await repos.shops.listAll(500, 0);
  const allOrders = await repos.orders.listAll({ limit: 500 });

  // Apply date filter if provided
  let orders = allOrders;
  if (dateFilter) {
    const dayStart = new Date(dateFilter + 'T00:00:00Z').getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    orders = allOrders.filter((o) => {
      const t = o.createdAt.getTime();
      return t >= dayStart && t < dayEnd;
    });
  }

  const byStatus = ORDER_STATUSES.reduce(
    (acc, s) => {
      acc[s] = orders.filter((o) => o.status === s).length;
      return acc;
    },
    {} as Record<OrderStatus, number>,
  );

  const paidOrders = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'awaiting_payment');
  const grossPaidValuePaise = paidOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);

  // Shop-wise breakdown
  const shopMap = new Map<string, { name: string; slug: string }>();
  for (const s of allShops) {
    shopMap.set(s.id, { name: s.name, slug: s.slug });
  }

  const shopWise = new Map<string, { shopId: string; shopName: string; orders: number; paidOrders: number; revenuePaise: number }>();
  for (const o of orders) {
    if (!shopWise.has(o.shopId)) {
      const info = shopMap.get(o.shopId);
      shopWise.set(o.shopId, { shopId: o.shopId, shopName: info?.name ?? 'Unknown', orders: 0, paidOrders: 0, revenuePaise: 0 });
    }
    const entry = shopWise.get(o.shopId)!;
    entry.orders++;
    if (o.status !== 'cancelled' && o.status !== 'awaiting_payment') {
      entry.paidOrders++;
      entry.revenuePaise += o.totalAmountPaise;
    }
  }

  // Service health (from the container's ready-check components)
  const container = getContainer();
  let dbHealthy = false;
  try { dbHealthy = await container.db.ping(); } catch { dbHealthy = false; }

  const agents = await repos.printAgents.listAll();
  const onlineAgents = agents.filter((a) => a.isOnline).length;
  const offlineAgents = agents.length - onlineAgents;

  return ok({
    platform: {
      totalShops: allShops.length,
      activeShops: allShops.filter((s) => s.isActive).length,
      inactiveShops: allShops.filter((s) => !s.isActive).length,
      totalOrders: orders.length,
      ordersByStatus: byStatus,
      paidOrders: paidOrders.length,
      grossPaidValuePaise,
      shopEarningsPaise: grossPaidValuePaise, // 0% commission — shop receives full amount
      platformRevenuePaise: 0, // NO commission model — documented
      pendingPaymentVerification: byStatus.awaiting_payment,
      // ARCH-006 fix: was `(byStatus.cancelled ?? 0) + orders.filter(... === 'cancelled').length`
      // — DOUBLE-COUNTED cancelled orders (byStatus.cancelled is ALREADY the
      // count of cancelled orders; adding the filter result again doubled it).
      failedOrDisputed: byStatus.cancelled ?? 0,
    },
    shops: Array.from(shopWise.values()).sort((a, b) => b.revenuePaise - a.revenuePaise),
    health: {
      database: dbHealthy ? 'healthy' : 'unhealthy',
      storage: container.storage.provider,
      cache: container.cache.provider,
      realtime: container.realtime.provider,
      agentsOnline: onlineAgents,
      agentsOffline: offlineAgents,
    },
  });
}, ['admin']);

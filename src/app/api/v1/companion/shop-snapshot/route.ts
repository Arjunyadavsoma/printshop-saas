import { withDeviceAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { ORDER_STATUSES, type OrderStatus } from '@platform/core/domain';
import { formatINRFromPaise } from '@platform/utils';

/**
 * GET /api/v1/companion/shop-snapshot — device-token-authed.
 *
 * The companion's SyncEngine pulls shop data through `shops/me/*`, which are
 * SHOPKEEPER-SESSION endpoints (JWT of a user). A Windows PC that paired via
 * a pairing ticket / device token has NO user session — it authenticated as a
 * DEVICE — so it could heartbeat, poll commands and auto-print, but its
 * Orders/Overview pages stayed empty forever. This follows the Universal
 * Print model instead: the device gets a read-only snapshot of ITS OWN
 * shop's queue through its own device credential. No user session is minted
 * and no session-scoped endpoint is opened to device JWTs.
 *
 * The response mirrors the exact wire shapes the companion already parses
 * for `shops/me`, `shops/me/orders` and `shops/me/analytics` — the rows come
 * from the same repositories, so the app maps them with its existing
 * mappers.
 *
 * Analytics follows the same entitlement rule as the shopkeeper dashboard
 * ('analytics' entitlement, starter plan+); a free-tier shop gets
 * `analytics: null` and the app shows em-dashes.
 */
export const GET = withDeviceAuth(async (_req, _ctx, { shopId }) => {
  const shop = await repos.shops.findById(shopId);
  if (!shop) {
    return ok({ shop: null, orders: [], analytics: null });
  }

  // Orders: same serializer as GET /shops/me/orders (limit 50, newest first).
  const orders = await repos.orders.listByShop(shop.id, { limit: 50 });

  // Analytics: same computation as GET /shops/me/analytics, gated by the
  // same entitlement. Failure to prove entitlement → null (not an error) so
  // the snapshot still delivers the queue to free-tier devices.
  let analytics: Record<string, unknown> | null = null;
  try {
    const { requireEntitlement } = await import('@/lib/api/entitlements');
    await requireEntitlement(shop.id, 'analytics');

    const all = await repos.orders.listByShop(shop.id, { limit: 200 });
    const paid = all.filter((o) => o.status !== 'cancelled' && o.status !== 'awaiting_payment');
    const revenuePaise = paid.reduce((acc, o) => acc + o.totalAmountPaise, 0);

    const byStatus = ORDER_STATUSES.reduce(
      (acc, s) => {
        acc[s] = all.filter((o) => o.status === s).length;
        return acc;
      },
      {} as Record<OrderStatus, number>,
    );

    const fileAgg = { color: 0, bw: 0, duplex: 0, simplex: 0, a4: 0, a3: 0, other: 0 };
    const filesByOrder = await repos.files.findByOrderIds(paid.map((o) => o.id));
    for (const o of paid) {
      const files = filesByOrder.get(o.id) ?? [];
      for (const f of files) {
        if (f.colorMode === 'color') fileAgg.color++; else fileAgg.bw++;
        if (f.duplex) fileAgg.duplex++; else fileAgg.simplex++;
        if (f.paperSize === 'a4') fileAgg.a4++; else if (f.paperSize === 'a3') fileAgg.a3++; else fileAgg.other++;
      }
    }

    const hours = new Array(24).fill(0) as number[];
    for (const o of all) hours[o.createdAt.getUTCHours()] = (hours[o.createdAt.getUTCHours()] ?? 0) + 1;
    const peakHour = hours.indexOf(Math.max(...hours));

    analytics = {
      revenue: { totalPaise: revenuePaise, formatted: formatINRFromPaise(revenuePaise) },
      orderCount: { total: all.length, paid: paid.length },
      byStatus,
      popular: fileAgg,
      peakHourUtc: peakHour >= 0 ? peakHour : null,
      hours,
    };
  } catch {
    analytics = null; // entitlement not proven (or computation failed) — queue still syncs
  }

  return ok({
    shop: { id: shop.id, name: shop.name, slug: shop.slug, timezone: shop.timezone },
    orders,
    analytics,
  });
});

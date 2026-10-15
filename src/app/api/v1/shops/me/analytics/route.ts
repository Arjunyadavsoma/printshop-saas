import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { ORDER_STATUSES, type OrderStatus } from '@platform/core/domain';
import { formatINRFromPaise } from '@platform/utils';

/** GET /api/v1/shops/me/analytics — revenue, status mix, popular settings. */
export const GET = withAuth(async (_req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);

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

  // Popular settings across all files in paid orders.
  const fileAgg = { color: 0, bw: 0, duplex: 0, simplex: 0, a4: 0, a3: 0, other: 0 };
  for (const o of paid) {
    const files = await repos.files.findByOrder(o.id);
    for (const f of files) {
      if (f.colorMode === 'color') fileAgg.color++; else fileAgg.bw++;
      if (f.duplex) fileAgg.duplex++; else fileAgg.simplex++;
      if (f.paperSize === 'a4') fileAgg.a4++; else if (f.paperSize === 'a3') fileAgg.a3++; else fileAgg.other++;
    }
  }

  // Peak hour histogram (orders by hour-of-day).
  const hours = new Array(24).fill(0) as number[];
  for (const o of all) hours[o.createdAt.getUTCHours()] = (hours[o.createdAt.getUTCHours()] ?? 0) + 1;
  const peakHour = hours.indexOf(Math.max(...hours));

  return ok({
    revenue: { totalPaise: revenuePaise, formatted: formatINRFromPaise(revenuePaise) },
    orderCount: { total: all.length, paid: paid.length },
    byStatus,
    popular: fileAgg,
    peakHourUtc: peakHour >= 0 ? peakHour : null,
    hours,
  });
});

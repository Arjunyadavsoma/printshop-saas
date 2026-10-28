import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { formatINRFromPaise } from '@platform/utils';
import { getZonedDayBounds } from '@/lib/utils/timezone';

/**
 * GET /api/v1/shops/me/reports/daily?date=YYYY-MM-DD
 *
 * Daily reconciliation report. Shows order counts by status, verified UPI
 * payments, pending verification, cancelled orders, total order value,
 * verified collections, outstanding amounts.
 *
 * Never counts a customer-submitted UTR as verified revenue — only
 * paidAt + paymentTxnId (set by authorized shopkeeper or verified webhook).
 *
 * TIMEZONE-SAFE (DB-002 fix): "today" is computed in the SHOP's timezone
 * (shop.timezone, default Asia/Kolkata), NOT server-local time. Previously
 * used `setHours(0,0,0,0)` which on Vercel (UTC) put the Kolkata "today"
 * boundary at 05:30 IST — misattributing up to 5h30m of orders to the
 * previous day. Now uses getZonedDayBounds() which computes the UTC instant
 * of the shop's timezone-local midnight via Intl.DateTimeFormat (correct for
 * Asia/Kolkata's UTC+5:30 + any DST-observing zone).
 */
export const GET = withAuth(async (req, _ctx, principal) => {
  try {
    const shop = await repos.shops.getByOwner(principal.userId);
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const tz = shop.timezone || 'Asia/Kolkata';
    // Compute the shop's timezone-local midnight as a UTC instant.
    const { start: startOfDay, end: endOfDay } = getZonedDayBounds(dateParam, tz);

    const orders = await repos.orders.listByShop(shop.id, { limit: 1000 });
    const todayOrders = orders.filter(o => {
      const created = new Date(o.createdAt);
      return created >= startOfDay && created <= endOfDay;
    });

    let totalValuePaise = 0, verifiedValuePaise = 0, pendingValuePaise = 0, cancelledValuePaise = 0;
    let verifiedCount = 0, pendingCount = 0, cancelledCount = 0;
    const byStatus: Record<string, number> = {};

    for (const o of todayOrders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      totalValuePaise += o.totalAmountPaise;
      if (o.paidAt && o.paymentTxnId) { verifiedValuePaise += o.totalAmountPaise; verifiedCount++; }
      else if (o.status === 'awaiting_payment') { pendingValuePaise += o.totalAmountPaise; pendingCount++; }
      if (o.status === 'cancelled') { cancelledValuePaise += o.totalAmountPaise; cancelledCount++; }
    }

    return ok({
      date: startOfDay.toISOString().slice(0, 10),
      timezone: tz,
      summary: { totalOrders: todayOrders.length, verifiedPayments: verifiedCount, pendingPayments: pendingCount, cancelledOrders: cancelledCount, byStatus },
      totals: {
        totalOrderValue: formatINRFromPaise(totalValuePaise),
        verifiedCollections: formatINRFromPaise(verifiedValuePaise),
        outstanding: formatINRFromPaise(pendingValuePaise),
        cancelledValue: formatINRFromPaise(cancelledValuePaise),
        totalOrderValuePaise: totalValuePaise,
        verifiedCollectionsPaise: verifiedValuePaise,
        outstandingPaise: pendingValuePaise,
        cancelledValuePaise: cancelledValuePaise,
      },
      orders: todayOrders.map(o => ({
        id: o.id, tokenNumber: o.tokenNumber ?? o.customerToken, status: o.status,
        totalAmount: formatINRFromPaise(o.totalAmountPaise), totalAmountPaise: o.totalAmountPaise,
        paymentVerified: !!(o.paidAt && o.paymentTxnId), paymentUtr: o.paymentUtr, paidAt: o.paidAt, createdAt: o.createdAt,
      })),
    });
  } catch (cause) { return fail(toAppError(cause)); }
}, ['owner']);

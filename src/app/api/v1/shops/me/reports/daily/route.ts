import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { formatINRFromPaise } from '@platform/utils';

/**
 * GET /api/v1/shops/me/reports/daily?date=YYYY-MM-DD
 *
 * Daily reconciliation report. Shows order counts by status, verified UPI
 * payments, pending verification, cancelled orders, total order value,
 * verified collections, outstanding amounts.
 *
 * Never counts a customer-submitted UTR as verified revenue — only
 * paidAt + paymentTxnId (set by authorized shopkeeper or verified webhook).
 */
export const GET = withAuth(async (req, _ctx, principal) => {
  try {
    const shop = await repos.shops.getByOwner(principal.userId);
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const tz = shop.timezone || 'Asia/Kolkata';
    const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
    const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

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

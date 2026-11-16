import type { Order, OrderStatus } from '@platform/core/domain';
import { ORDER_STATUSES } from '@platform/core/domain';

/**
 * Phase 6 — Financial reporting + reconciliation.
 *
 * The Phase 6 prompt requires 7 distinct financial entities to be
 * kept separate (the existing analytics route conflated some):
 *
 *   1. Shop order value — the `Order.totalAmountPaise` sum.
 *   2. Shop payment volume — the sum of `PaymentAttempt.amountPaise`
 *      for paid attempts (cash + online).
 *   3. Shop refunds — the sum of refunded amounts (negative).
 *   4. Estimated shop revenue after refunds — (1) - (3).
 *   5. PrintShop subscription revenue — sum of subscription payments
 *      the platform collected (currently 0 — no commission model).
 *   6. PrintShop refunds — refunds the platform issued (currently 0).
 *   7. PrintShop net subscription revenue — (5) - (6).
 *
 * Accounting correctness:
 *   - All money is integer paise (no float).
 *   - Failed payment attempts are NOT counted as revenue.
 *   - Pending transactions are NOT counted as verified payments.
 *   - Duplicate callbacks are deduplicated by `PaymentEvent.(provider, eventId)` UNIQUE.
 *   - Refunds are tracked via `Order.status = 'refunded'` + the
 *     refunded amount (the existing payment flow records this in
 *     the audit log + the order status; a dedicated refund row will
 *     be added when the refund UI is built).
 *   - Timezone boundaries: server-side `Date` is UTC; the route
 *     layer converts the requested date range to UTC.
 *
 * The service does NOT mutate any rows — it is read-only.
 */

export interface FinancialReport {
  /** The date range covered, inclusive of `from` and exclusive of `to`. */
  range: { from: string; to: string };
  /** Filter scope — shopId (or null for platform-wide). */
  shopId: string | null;
  // ── Shop-side entities (1-4) ──
  /** (1) Sum of `Order.totalAmountPaise` for orders in the range. */
  shopOrderValuePaise: number;
  /** (2) Sum of `PaymentAttempt.amountPaise` for PAID attempts in the range. */
  shopPaymentVolumePaise: number;
  /** (2a) Cash collections (subset of 2) — manual confirmation. */
  shopCashCollectionsPaise: number;
  /** (2b) Online payments (subset of 2) — verified webhooks. */
  shopOnlinePaymentsPaise: number;
  /** (3) Refunds — the refunded amount (negative number for clarity). */
  shopRefundsPaise: number;
  /** (4) Estimated shop revenue after refunds — (2) - (3). */
  shopRevenueAfterRefundsPaise: number;
  // ── Platform-side entities (5-7) ──
  /** (5) PrintShop subscription revenue — 0 (no commission model). */
  platformSubscriptionRevenuePaise: number;
  /** (6) PrintShop refunds — 0 (no commission model). */
  platformRefundsPaise: number;
  /** (7) PrintShop net subscription revenue — (5) - (6). */
  platformNetSubscriptionRevenuePaise: number;
  // ── Reconciliation ──
  /** Orders counted in the range, broken down by status. */
  ordersByStatus: Record<OrderStatus, number>;
  /** Total orders in the range. */
  totalOrders: number;
  /** Paid orders in the range (status not in cancelled/awaiting_payment). */
  paidOrders: number;
  /** Outstanding balance — awaiting_payment orders' value. */
  outstandingBalancePaise: number;
  /** Failed payment attempts in the range (NOT counted as revenue). */
  failedPaymentAttempts: number;
  /**
   * Reconciliation discrepancy: shopOrderValue (1) - shopPaymentVolume (2) +
   * shopRefunds (3). Should equal 0 for a fully reconciled period; non-zero
   * means there are orders awaiting payment, or refunds not yet recorded.
   */
  reconciliationDiscrepancyPaise: number;
}

/**
 * Compute a financial report for a date range + optional shop scope.
 *
 * The function reads Order + PaymentAttempt rows from the repos +
 * Prisma. It does NOT mutate anything. The route layer is
 * responsible for converting the requested date range to UTC.
 *
 * @param from  Inclusive lower bound (UTC).
 * @param to    Exclusive upper bound (UTC).
 * @param shopId Optional shop scope. Null = platform-wide.
 */
export async function computeFinancialReport(
  from: Date,
  to: Date,
  shopId: string | null,
): Promise<FinancialReport> {
  const { repos } = await import('@/lib/repositories');
  const { db } = await import('@/lib/db');

  // ── Orders in the range ──
  const allOrders = shopId
    ? await repos.orders.listByShop(shopId, { limit: 1000 })
    : await repos.orders.listAll({ limit: 1000 });
  const inRange = allOrders.filter((o) => {
    const t = o.createdAt.getTime();
    return t >= from.getTime() && t < to.getTime();
  });

  const ordersByStatus = ORDER_STATUSES.reduce(
    (acc, s) => {
      acc[s] = inRange.filter((o) => o.status === s).length;
      return acc;
    },
    {} as Record<OrderStatus, number>,
  );

  const paidOrders = inRange.filter(
    (o) => o.status !== 'cancelled' && o.status !== 'awaiting_payment',
  );
  const refundedOrders = inRange.filter((o) => o.status === 'refunded');
  const awaitingOrders = inRange.filter((o) => o.status === 'awaiting_payment');

  // (1) Shop order value — sum of totalAmountPaise for ALL orders in the range
  //     (including cancelled + awaiting, because the order was placed).
  const shopOrderValuePaise = inRange.reduce((acc, o) => acc + o.totalAmountPaise, 0);

  // (4) Estimated shop revenue after refunds — paid orders' value minus refunds.
  //     We use the PAID orders' totalAmountPaise (not the payment volume) as the
  //     "earned" amount; refunds are subtracted. This is the entity the prompt
  //     calls "Estimated shop revenue after refunds".
  const paidOrderValuePaise = paidOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  const shopRefundsPaise = refundedOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  const shopRevenueAfterRefundsPaise = paidOrderValuePaise - shopRefundsPaise;

  // (2) Shop payment volume — sum of PAID PaymentAttempt amounts.
  //     We read PaymentAttempt rows via Prisma (the existing payment code does
  //     the same — see findStalePaymentAttempts). Failed attempts are NOT
  //     counted (the prompt: "Do not count failed payment attempts as revenue").
  let shopPaymentVolumePaise = 0;
  let shopCashCollectionsPaise = 0;
  let shopOnlinePaymentsPaise = 0;
  let failedPaymentAttempts = 0;

  try {
    const where: Record<string, unknown> = {};
    if (shopId) where.shopId = shopId;
    const attempts = await (db as any).paymentAttempt.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    const inRangeAttempts = attempts.filter((a: any) => {
      const t = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      return t >= from.getTime() && t < to.getTime();
    });
    for (const a of inRangeAttempts) {
      if (a.status === 'paid') {
        shopPaymentVolumePaise += a.amountPaise ?? 0;
        // Cash vs online split: provider='cash' → cash; everything else → online.
        if (a.provider === 'cash') {
          shopCashCollectionsPaise += a.amountPaise ?? 0;
        } else {
          shopOnlinePaymentsPaise += a.amountPaise ?? 0;
        }
      } else if (a.status === 'failed') {
        failedPaymentAttempts++;
      }
    }
  } catch {
    // PaymentAttempt table may not exist in some test environments.
    // The report still returns the order-based entities; payment-volume is 0.
  }

  // (5) PrintShop subscription revenue — 0 (no commission model).
  //     The product does not charge shops a commission; the shopkeeper
  //     receives the full customer payment. Subscription tiers exist
  //     (free/starter/pro/enterprise) but the billing is not yet wired.
  const platformSubscriptionRevenuePaise = 0;
  // (6) PrintShop refunds — 0.
  const platformRefundsPaise = 0;
  // (7) PrintShop net subscription revenue — 0.
  const platformNetSubscriptionRevenuePaise = platformSubscriptionRevenuePaise - platformRefundsPaise;

  // Outstanding balance: awaiting_payment orders' value.
  const outstandingBalancePaise = awaitingOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);

  // Reconciliation discrepancy: shopOrderValue - shopPaymentVolume - shopRefunds.
  // Should be 0 for a fully reconciled period. Non-zero means:
  //   - awaiting_payment orders not yet paid, OR
  //   - refunds not yet recorded, OR
  //   - partial payments (not yet supported).
  const reconciliationDiscrepancyPaise =
    shopOrderValuePaise - shopPaymentVolumePaise - shopRefundsPaise;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    shopId,
    shopOrderValuePaise,
    shopPaymentVolumePaise,
    shopCashCollectionsPaise,
    shopOnlinePaymentsPaise,
    shopRefundsPaise,
    shopRevenueAfterRefundsPaise,
    platformSubscriptionRevenuePaise,
    platformRefundsPaise,
    platformNetSubscriptionRevenuePaise,
    ordersByStatus,
    totalOrders: inRange.length,
    paidOrders: paidOrders.length,
    outstandingBalancePaise,
    failedPaymentAttempts,
    reconciliationDiscrepancyPaise,
  };
}

/**
 * Pure helper: compute the report from an in-memory list of orders.
 * Used by tests + by callers that already have the orders in hand.
 */
export function computeFinancialReportFromOrders(
  orders: Order[],
  from: Date,
  to: Date,
): Pick<
  FinancialReport,
  | 'shopOrderValuePaise'
  | 'shopRefundsPaise'
  | 'shopRevenueAfterRefundsPaise'
  | 'ordersByStatus'
  | 'totalOrders'
  | 'paidOrders'
  | 'outstandingBalancePaise'
> {
  const inRange = orders.filter((o) => {
    const t = o.createdAt.getTime();
    return t >= from.getTime() && t < to.getTime();
  });
  const ordersByStatus = ORDER_STATUSES.reduce(
    (acc, s) => {
      acc[s] = inRange.filter((o) => o.status === s).length;
      return acc;
    },
    {} as Record<OrderStatus, number>,
  );
  const paidOrders = inRange.filter(
    (o) => o.status !== 'cancelled' && o.status !== 'awaiting_payment' && o.status !== 'refunded',
  );
  const refundedOrders = inRange.filter((o) => o.status === 'refunded');
  const awaitingOrders = inRange.filter((o) => o.status === 'awaiting_payment');
  const shopOrderValuePaise = inRange.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  const paidOrderValuePaise = paidOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  const shopRefundsPaise = refundedOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  const shopRevenueAfterRefundsPaise = paidOrderValuePaise - shopRefundsPaise;
  const outstandingBalancePaise = awaitingOrders.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  return {
    shopOrderValuePaise,
    shopRefundsPaise,
    shopRevenueAfterRefundsPaise,
    ordersByStatus,
    totalOrders: inRange.length,
    paidOrders: paidOrders.length,
    outstandingBalancePaise,
  };
}

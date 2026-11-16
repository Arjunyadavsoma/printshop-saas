import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withAdminPermission } from '@/lib/api/with-auth';
import { computeFinancialReport } from '@/lib/services/financial-reporting.service';
import { ValidationError } from '@platform/core/errors';

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shopId: z.string().uuid().optional(),
  range: z.enum(['today', 'week', 'month', 'ytd']).optional(),
});

/**
 * GET /api/v1/admin/financial-report/export — CSV export of the
 * financial report.
 *
 * Returns a CSV with one row per metric. Safe to open in a
 * spreadsheet. All monetary values are integer paise.
 *
 * Authorization: requires the `finance.read` admin permission.
 * The same query params as /api/v1/admin/financial-report.
 */
export const GET = withAdminPermission('finance.read', async (req) => {
  try {
    const params = QuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    let from: Date;
    let to: Date;
    if (params.range) {
      const now = new Date();
      switch (params.range) {
        case 'today':
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'week':
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
          to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
          break;
        case 'ytd':
          from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
          to = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
          break;
      }
    } else if (params.date) {
      from = new Date(params.date + 'T00:00:00Z');
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    } else if (params.from && params.to) {
      from = new Date(params.from);
      to = new Date(params.to);
      if (from >= to) {
        return NextResponse.json(
          { success: false, error: { code: 'VALIDATION_ERROR', message: '`from` must be before `to`' } },
          { status: 400 },
        );
      }
    } else {
      const now = new Date();
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    }

    const report = await computeFinancialReport(from, to, params.shopId ?? null);

    // CSV: one row per metric. Quote the metric name + value to handle
    // commas safely. All values are integers (no float precision issues).
    const rows: string[] = [];
    rows.push('metric,value_paise');
    rows.push(`shop_order_value,${report.shopOrderValuePaise}`);
    rows.push(`shop_payment_volume,${report.shopPaymentVolumePaise}`);
    rows.push(`shop_cash_collections,${report.shopCashCollectionsPaise}`);
    rows.push(`shop_online_payments,${report.shopOnlinePaymentsPaise}`);
    rows.push(`shop_refunds,${report.shopRefundsPaise}`);
    rows.push(`shop_revenue_after_refunds,${report.shopRevenueAfterRefundsPaise}`);
    rows.push(`platform_subscription_revenue,${report.platformSubscriptionRevenuePaise}`);
    rows.push(`platform_refunds,${report.platformRefundsPaise}`);
    rows.push(`platform_net_subscription_revenue,${report.platformNetSubscriptionRevenuePaise}`);
    rows.push(`total_orders,${report.totalOrders}`);
    rows.push(`paid_orders,${report.paidOrders}`);
    rows.push(`outstanding_balance,${report.outstandingBalancePaise}`);
    rows.push(`failed_payment_attempts,${report.failedPaymentAttempts}`);
    rows.push(`reconciliation_discrepancy,${report.reconciliationDiscrepancyPaise}`);
    // Per-status order counts.
    for (const [status, count] of Object.entries(report.ordersByStatus)) {
      rows.push(`orders_${status},${count}`);
    }
    const csv = rows.join('\n') + '\n';

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="financial-report-${from.toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
});

import { type NextRequest } from 'next/server';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';

/**
 * GET /api/v1/payments/upi/verify/:orderId — fallback status check.
 *
 * UPI deep-link has no server-side webhook, so the customer-status poller
 * relies on this: it consults our own DB (which the PSP webhook or the
 * dev mark-paid route updates). In Phase 3 this consults the PSP status API.
 *
 * SEC-001 / C2 fix: previously this route was UNAUTHENTICATED — the order
 * UUID in the URL was the only "credential", so anyone who learned it
 * (browser history, referrer leak, screenshot) could read another
 * customer's payment txn id, UTR, and amount. Now wrapped with
 * `withOrderAccess` (paramKey='orderId' since the route uses [orderId])
 * exactly like /api/v1/orders/:id/status — the caller MUST prove they know
 * the order's `customerToken` via the `X-Order-Token` header or the `?t=`
 * query param. The order row is loaded + verified by the guard and passed
 * to the handler; no re-fetch needed.
 */
export const GET = withRateLimit<{ orderId: string }>(
  'upi-verify',
  60,
  60,
  withOrderAccess<{ orderId: string }>(
    async (_req, _ctx, order) => {
      const paid = ['paid', 'printing', 'ready', 'collected'].includes(order.status);
      return ok({
        paid,
        txnId: order.paymentTxnId,
        utr: order.paymentUtr,
        amountPaise: paid ? order.totalAmountPaise : null,
        status: order.status,
      });
    },
    'orderId',
  ),
);

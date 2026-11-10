import { type NextRequest } from 'next/server';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { formatINRFromPaise } from '@platform/utils';

/** GET /api/v1/orders/:id/status — poll payment + print status.
 *
 * SEC-001 fix: this route is now behind withOrderAccess — the caller MUST
 * prove they know the order's `customerToken` (via the X-Order-Token
 * header or the ?t= query param). Previously the order UUID in the URL
 * was the only credential, so anyone who learned it could read another
 * customer's order status. The handler receives the already-verified
 * order row as the third argument — no need to re-fetch.
 *
 * Phase 6 P0-01 fix: `customerToken` is NO LONGER returned in the response
 * body. The caller already possesses it (they used it to authenticate),
 * so returning it is redundant and risks leaking the bearer secret in
 * logged responses. The frontend reads the token from sessionStorage or
 * the URL — it does not need it echoed back. */
export const GET = withRateLimit<{ id: string }>(
  'status',
  120,
  60,
  withOrderAccess<{ id: string }>(async (_req, _ctx, order) => {
    try {
      const files = await repos.files.findByOrder(order.id);
      // `tokenNumber` is the per-shop sequential token (e.g. "A001") — the SAME
      // token the shopkeeper sees in their dashboard. Including it here lets the
      // customer tracking page show the SAME token as the shopkeeper, so both
      // parties can reference the order by the same number.
      // `paidAt` + `paymentTxnId` let the customer UI show a separate payment
      // status indicator (green checkmark when confirmed, pending when null).
      return ok({
        orderId: order.id,
        tokenNumber: order.tokenNumber,
        status: order.status,
        totalAmountPaise: order.totalAmountPaise,
        totalFormatted: formatINRFromPaise(order.totalAmountPaise),
        currency: order.currency,
        paidAt: order.paidAt,
        paymentTxnId: order.paymentTxnId,
        paymentUtr: order.paymentUtr,
        files: files.map((f) => ({
          id: f.id,
          filename: f.originalFilename,
          status: f.status,
          copies: f.copies,
          colorMode: f.colorMode,
          duplex: f.duplex,
          printedAt: f.printedAt,
        })),
        updatedAt: order.updatedAt,
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  }),
);

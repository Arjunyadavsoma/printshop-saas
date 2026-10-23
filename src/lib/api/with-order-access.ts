import { NextResponse, type NextRequest } from 'next/server';
import { repos } from '@/lib/repositories';
import { fail, toAppError } from '@/lib/api/envelope';
import { timingSafeEqual } from 'node:crypto';
import { NotFoundError, ForbiddenError } from '@platform/core/errors';

/**
 * withOrderAccess — customer-facing order-route guard against IDOR.
 *
 * PROBLEM (SEC-001): the customer-facing order routes
 * (`/api/v1/orders/:id/{status,receipt,files,files/upload-url,files/[fileId],checkout}`)
 * were UNAUTHENTICATED — the order UUID in the URL path was the only
 * "credential". Anyone who learned the UUID (browser history, referrer
 * leak, screenshot, support ticket) could read the order status, download
 * the receipt, UPLOAD malicious PDFs into another customer's order, and
 * PATCH the print settings on someone else's files (re-pricing).
 *
 * FIX: every customer-facing order route now goes through withOrderAccess,
 * which requires a per-order `customerToken` (issued at order-creation time
 * — `POST /api/v1/shops/:slug/orders` returns it). The token is sent via:
 *   - the `X-Order-Token` header (preferred — doesn't appear in URLs/logs),
 *   - OR the `?t=` query param (fallback for the receipt download link,
 *     which opens as a navigation, not a fetch).
 *
 * The token is constant-time-compared against `order.customerToken` to
 * resist timing attacks. A mismatch → 403 Forbidden (NOT 404 — the order
 * exists, you just can't access it; 404 would let an attacker probe
 * order IDs to learn which exist).
 *
 * Usage (standalone):
 *   export const GET = withOrderAccess<{ id: string }>(async (req, ctx, order) => {
 *     return ok({ ... });
 *   });
 *
 * Usage (with rate-limiting — rate-limit OUTER, order-access INNER so
 * brute-force token attempts are rate-limited):
 *   export const GET = withRateLimit('status', 120, 60,
 *     withOrderAccess<{ id: string }>(async (req, ctx, order) => { ... })
 *   );
 */

/** Constant-time string comparison. Returns true if a === b. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract the order-access token from the request (header first, then query). */
function getOrderToken(req: NextRequest): string | null {
  const header = req.headers.get('x-order-token');
  if (header) return header.trim();
  const query = req.nextUrl.searchParams.get('t');
  if (query) return query.trim();
  return null;
}

/**
 * Wrap a handler so it only runs if the caller proves they know the order's
 * `customerToken`. On success, the handler receives the fully-loaded Order
 * row as the third argument — no need to re-fetch or re-verify.
 */
export function withOrderAccess<TParams = { id: string }>(
  handler: (
    req: NextRequest,
    ctx: { params: Promise<TParams> },
    order: NonNullable<Awaited<ReturnType<typeof repos.orders.findById>>>,
  ) => Promise<NextResponse> | NextResponse,
) {
  return async (req: NextRequest, ctx: { params: Promise<TParams> }): Promise<NextResponse> => {
    try {
      const { id } = (await ctx.params) as unknown as { id: string };
      const order = await repos.orders.findById(id);
      if (!order) {
        throw new NotFoundError('Order not found');
      }
      const token = getOrderToken(req);
      if (!token) {
        // No token provided — the customer's link is incomplete (they
        // bookmarked /orders/<id> without the ?t= query). Tell them clearly.
        throw new ForbiddenError(
          'This order link is incomplete. Open the full link from your receipt or the order-confirmation page (it includes a ?t= token).',
        );
      }
      if (!order.customerToken || !safeEqual(token, order.customerToken)) {
        // Wrong token — constant-time compared. Don't reveal whether the
        // order exists (return 403, same as the no-token case).
        throw new ForbiddenError('Order access token does not match.');
      }
      // Token is valid — run the handler with the loaded order.
      return await handler(req, ctx, order);
    } catch (cause) {
      return fail(toAppError(cause));
    }
  };
}

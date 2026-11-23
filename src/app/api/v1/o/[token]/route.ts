import { NextRequest } from 'next/server';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { orderTracking } from '@/lib/orders/order-flow';
import { NotFoundError, AppError } from '@platform/core/errors';

/**
 * GET /api/v1/o/[token] — customer tracking (no login). Works on a phone
 * from the QR receipt; the token IS the credential.
 *
 * P9-Security §1 hardening:
 *   - Rate limit lowered to 60 req/min per IP (was 240). The tracking
 *     endpoint is unauthenticated, so the only brake on brute-force token
 *     guessing is the rate limit; 60/min lets a customer poll every second
 *     (well above the 5s cadence the client uses) while throttling a
 *     scanner by ~4×. A real brute-force attack needs ≥2³² / 60 / 60 / 24 / 365
 *     ≈ 9 years to cover the 32-bit token space at 60/min — and 128-bit
 *     tokens are out of reach forever.
 *   - Unknown and expired tokens return the SAME 404 NOT_FOUND response
 *     (handled in `orderTracking`), so an attacker cannot enumerate which
 *     tokens map to real orders by inspecting the response shape.
 */
export const GET = withRateLimit<{ token: string }>('order-track', 60, 60, async (_req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
  try {
    const { token } = await ctx.params;
    return ok(await orderTracking(token));
  } catch (cause) {
    const status = cause instanceof NotFoundError ? 404 : undefined;
    if (status) return fail(new AppError('Order not found', 'NOT_FOUND', 404));
    return fail(toAppError(cause));
  }
});

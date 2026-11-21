import { NextRequest } from 'next/server';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { orderTracking } from '@/lib/orders/order-flow';
import { NotFoundError, AppError } from '@platform/core/errors';

/**
 * GET /api/v1/o/[token] — customer tracking (no login). Works on a phone
 * from the QR receipt; the token IS the credential.
 */
export const GET = withRateLimit<{ token: string }>('order-track', 240, 60, async (_req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
  try {
    const { token } = await ctx.params;
    return ok(await orderTracking(token));
  } catch (cause) {
    const status = cause instanceof NotFoundError ? 404 : undefined;
    if (status) return fail(new AppError('Order not found', 'NOT_FOUND', 404));
    return fail(toAppError(cause));
  }
});

import { NextResponse } from 'next/server';

/**
 * Dev-only route guard. Returns a 404 when NODE_ENV=production so the
 * simulate/seed/mark-paid/dev-qr routes can't be hit on a live deploy.
 * In development they remain available for the demo + local testing.
 *
 * Usage at the top of a dev route:
 *   const guard = requireDev();
 *   if (guard) return guard;
 */
export function requireDev(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Not available in production' } },
      { status: 404 },
    );
  }
  return null;
}

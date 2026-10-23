import { NextResponse } from 'next/server';

/**
 * Dev-only route guard. Returns a 404 UNLESS NODE_ENV='development' so the
 * simulate/seed/mark-paid/dev-qr routes can't be hit on a live deploy OR a
 * staging/preview deployment.
 *
 * Previously this checked `=== 'production'` which meant any other value
 * ('staging', unset, 'test' in some configs) would FAIL OPEN — exposing
 * the `/dev/orders/:id/mark-paid` route (which lets anyone mark any order
 * paid for free). Inverting to fail-closed (`!== 'development'`) closes
 * the gap: only an explicit dev environment exposes these routes.
 *
 * Usage at the top of a dev route:
 *   const guard = requireDev();
 *   if (guard) return guard;
 */
export function requireDev(): NextResponse | null {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Not available' } },
      { status: 404 },
    );
  }
  return null;
}

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers middleware (spec §4.6).
 * Adds Content-Security-Policy, X-Content-Type-Options, X-Frame-Options,
 * Referrer-Policy, and Permissions-Policy to every response. Runs on the
 * Edge runtime (no Node.js deps).
 */
export function middleware(_req: NextRequest) {
  const res = NextResponse.next();
  // CSP: allow same-origin scripts/styles/images; allow data: for QR images;
  // allow upi: scheme for the UPI deep-link navigation on mobile.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js dev needs unsafe-eval; tighten in prod
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:", // socket.io
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return res;
}

export const config = {
  // Run on all routes except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)'],
};

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers middleware (spec §4.6).
 * Adds Content-Security-Policy, X-Content-Type-Options, X-Frame-Options,
 * Referrer-Policy, and Permissions-Policy to every response. Runs on the
 * Edge runtime (no Node.js deps).
 *
 * CSP note: the `connect-src` + `img-src` directives include the Supabase
 * Storage origin (from the SUPABASE_URL env var) so the browser allows:
 *   - XHR PUT to the Supabase signed upload URL (customer file uploads).
 *   - <img src="..."> for the Supabase presigned download URLs (UPI QR images,
 *     customer document previews, shopkeeper-uploaded QR codes).
 * Without this, the browser blocks cross-origin PUTs/downloads to Supabase
 * Storage → "Network error during upload" on the customer order page.
 *
 * In local dev (STORAGE_PROVIDER=memory), SUPABASE_URL is NOT set → the
 * Supabase origin is NOT added → the CSP falls back to 'self' only (the
 * in-memory storage uses same-origin /api/v1/storage/put + /api/v1/storage/get
 * routes, which 'self' allows).
 */
export function middleware(_req: NextRequest) {
  const res = NextResponse.next();

  // Derive the Supabase origin from the env var (if configured).
  // SUPABASE_URL is the project URL, e.g. "https://duyharicyurufmsjyhgs.supabase.co".
  // Storage uses the same origin (https://<project>.supabase.co/storage/v1/...).
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  // Extract just the origin (strip any trailing path/query).
  let supabaseOrigin = '';
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      supabaseOrigin = u.origin; // e.g. "https://duyharicyurufmsjyhgs.supabase.co"
    }
  } catch {
    // If SUPABASE_URL is not a valid URL, don't add it to the CSP.
  }

  // Build the CSP directives. The Supabase origin is added to connect-src
  // (for XHR PUT uploads) + img-src (for presigned download URLs) only when
  // SUPABASE_URL is set (production). In dev (memory storage), it's omitted.
  // The PrintLatch agent runs locally at http://127.0.0.1:32191. The browser
  // needs to talk to it for direct printing (fetch the PDF from the server's
  // presigned URL → send bytes to the local agent). This is a loopback address
  // (treated as a secure context by browsers even on HTTPS pages).
  // The Native Windows Printer service runs at http://127.0.0.1:32192.
  const printlatchOrigin = 'http://127.0.0.1:32191';
  const nativePrinterOrigin = 'http://127.0.0.1:32192';

  const connectSrc = supabaseOrigin
    ? `'self' ws: wss: ${supabaseOrigin} ${printlatchOrigin} ${nativePrinterOrigin}`
    : `'self' ws: wss: ${printlatchOrigin} ${nativePrinterOrigin}`;
  const imgSrc = supabaseOrigin
    ? `'self' data: blob: ${supabaseOrigin}`
    : "'self' data: blob:";

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js dev needs unsafe-eval; tighten in prod
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS — enforce HTTPS for 2 years (includes subdomains). Vercel already
  // sets this, but being explicit here ensures it's always present even
  // if the Vercel config changes.
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return res;
}

export const config = {
  // Run on all routes except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)'],
};

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
 *
 * CSP note (Clerk): the Clerk JS SDK loads its script from the Clerk
 * Frontend API domain and talks to it over XHR, so that origin must be in
 * `script-src` + `connect-src` whenever Clerk is configured. Without it the
 * SDK never initializes, `useSignIn()` stays unloaded, the "Continue with
 * Google" button stays disabled — and tapping it does nothing at all.
 * The domain is the app's custom Clerk Frontend API domain (Clerk
 * dashboard + DNSHE `clerk` CNAME → frontend-api.clerk.services). If the
 * custom domain ever changes, update CLERK_FRONTEND_API_ORIGIN below.
 */
export function middleware(req: NextRequest) {
  // AUDIT P1-7: /dev/* pages were publicly reachable on production (a
  // statically prerendered page never reaches a layout-level gate, so the
  // gate lives here at the request layer — the one place static output
  // cannot bypass). Fail closed like requireDev().
  if (req.nextUrl.pathname.startsWith('/dev') && process.env.NODE_ENV !== 'development') {
    return new NextResponse('Not available', { status: 404 });
  }

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

  // Clerk Frontend API origin + protection CDN — only added when Clerk is
  // configured (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set), mirroring the
  // Supabase gate.
  // Clerk loads its runtime from TWO origins:
  //   1. The custom Frontend API domain (clerk.printelyx.cc.cd) — the main
  //      JS bundle + XHR endpoints.
  //   2. cdn.protect.clerk.com — the Clerk protection/bot-detection script
  //      (bootstrap.js). Without this in script-src, the browser blocks the
  //      load → Clerk never initializes → "Continue with Google" is dead.
  // Both must be in script-src AND connect-src.
  // Clerk also creates Web Workers from blob: URLs (for its telemetry +
  // protection checks). Without `worker-src 'self' blob:`, the browser
  // falls back to script-src (which doesn't include blob:) → the worker
  // creation is blocked → Clerk logs a CSP violation + degrades.
  const CLERK_FRONTEND_API_ORIGIN = 'https://clerk.printelyx.cc.cd';
  const CLERK_PROTECT_CDN = 'https://cdn.protect.clerk.com';
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkOrigins = clerkConfigured
    ? `${CLERK_FRONTEND_API_ORIGIN} ${CLERK_PROTECT_CDN}`
    : '';

  const connectSrc = supabaseOrigin
    ? `'self' ws: wss: blob: ${supabaseOrigin} ${printlatchOrigin} ${nativePrinterOrigin}${clerkOrigins ? ` ${clerkOrigins}` : ''}`
    : `'self' ws: wss: blob: ${printlatchOrigin} ${nativePrinterOrigin}${clerkOrigins ? ` ${clerkOrigins}` : ''}`;
  const imgSrc = supabaseOrigin
    ? `'self' data: blob: ${supabaseOrigin}`
    : "'self' data: blob:";

  // CSP — Next.js 16 requires 'unsafe-inline' in script-src for its inline
  // hydration scripts (SSR data, RSC payload, etc.). Without it, the page
  // renders blank + the browser console shows "Executing inline script
  // violates Content Security Policy directive". We keep 'unsafe-eval' out
  // of production (it's only needed for Turbopack HMR in dev).
  // worker-src: Clerk creates Web Workers from blob: URLs. Without an
  // explicit worker-src, the browser falls back to script-src (which can't
  // match blob:) → worker creation is blocked. Adding `worker-src 'self'
  // blob:` allows Clerk's workers without weakening script-src.
  const isProduction = process.env.NODE_ENV === 'production';
  const scriptSrc = isProduction
    ? `script-src 'self' 'unsafe-inline'${clerkOrigins ? ` ${clerkOrigins}` : ''}` // prod: unsafe-inline required by Next.js, no unsafe-eval
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval'${clerkOrigins ? ` ${clerkOrigins}` : ''}`; // dev: Turbopack HMR needs both
  const workerSrc = `worker-src 'self' blob:`;
  const csp = [
    "default-src 'self'",
    scriptSrc,
    workerSrc,
    "style-src 'self' 'unsafe-inline'", // Next.js injects styles inline (required)
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  res.headers.set('Content-Security-Policy', csp);
  // COOP/COEP — defense-in-depth against cross-origin window references
  // (spectre-class attacks). frame-ancestors 'none' already blocks embedding;
  // COOP same-origin blocks window.opener access; COEP credentialless loads
  // cross-origin resources without credentials.
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions-Policy: camera and microphone stay fully disabled, but
  // geolocation MUST be allowed for our own origin — /find-a-shop's
  // "Detect my location" uses navigator.geolocation, and `geolocation=()`
  // makes getCurrentPosition fail instantly with PERMISSION_DENIED on
  // every browser (no prompt is ever shown). That header was the reason
  // location detection never worked on real phones. No third-party
  // origin gets geolocation access — (self) only.
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
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

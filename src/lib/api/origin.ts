/**
 * Resolve the canonical deployment origin (e.g.
 * `https://printshop-saas-three.vercel.app`) from an incoming request.
 *
 * Used by routes that generate customer-facing URLs (the shop QR code, the
 * sticker sheet, the print-agent download URLs). Hard-coding
 * `process.env.APP_BASE_URL` is brittle: if the env var isn't set on a new
 * deployment, the QR encodes `http://localhost:3000/<slug>` (unreachable
 * from a customer's phone) — and if the deployment moves to a new domain,
 * previously-generated URLs break.
 *
 * This helper derives the origin from the request's standard headers
 * (`x-forwarded-host` + `x-forwarded-proto` on Vercel/typical proxies, or
 * the plain `host` header in local dev), so the URL always matches the
 * deployment the shopkeeper is actually using.
 *
 * Fallbacks (in order): request headers -> APP_BASE_URL env var ->
 * `http://localhost:3000`. The env-var fallback is kept for tests + any
 * edge case where headers aren't present (e.g. a background job without a
 * request context — those callers should pass `APP_BASE_URL` explicitly).
 */
import type { NextRequest } from 'next/server';

export function getDeploymentOrigin(req?: NextRequest | Request | null): string {
  if (req) {
    const xfProto =
      (req as NextRequest).headers?.get('x-forwarded-proto') ??
      (req.headers as Headers | undefined)?.get('x-forwarded-proto');
    const xfHost =
      (req as NextRequest).headers?.get('x-forwarded-host') ??
      (req.headers as Headers | undefined)?.get('x-forwarded-host');
    const host =
      xfHost ??
      (req as NextRequest).headers?.get('host') ??
      (req.headers as Headers | undefined)?.get('host');
    if (host) {
      const proto = xfProto ?? (host.startsWith('localhost') ? 'http' : 'https');
      return `${proto}://${host}`;
    }
  }
  // No request context — fall back to the configured env var, then dev.
  return process.env.APP_BASE_URL ?? 'http://localhost:3000';
}

/**
 * Build the customer-facing URL for a shop (e.g.
 * `https://printshop-saas-three.vercel.app/quickprint`). This is what the
 * shop QR code encodes — scanning it opens the shop's customer-facing page
 * on whatever deployment the shopkeeper is currently using.
 */
export function getShopCustomerUrl(
  shopSlug: string,
  req?: NextRequest | Request | null,
): string {
  return `${getDeploymentOrigin(req)}/${shopSlug}`;
}

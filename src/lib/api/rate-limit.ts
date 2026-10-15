import type { CacheAdapter } from '@platform/core/interfaces';
import { RateLimitError } from '@platform/core/errors';

/**
 * Fixed-window rate limiter backed by the {@link CacheAdapter}.
 * Returns ok if under limit; throws RateLimitError otherwise.
 *
 * @param cache - the cache adapter
 * @param key - uniqueness key (e.g. ip + route)
 * @param limit - max hits per window
 * @param windowSeconds - window length in seconds
 */
export async function rateLimit(
  cache: CacheAdapter,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ remaining: number }> {
  const count = await cache.incr(key);
  if (count === 1) {
    await cache.expire(key, windowSeconds);
  }
  if (count > limit) {
    throw new RateLimitError(`Rate limit exceeded (${limit}/${windowSeconds}s)`);
  }
  return { remaining: limit - count };
}

/**
 * Derive the client IP. Behind a trusted proxy (default — the Caddy
 * gateway), reads X-Forwarded-For. If TRUSTED_PROXY is not set in
 * production, falls back to 'unknown' (fails open on rate limiting rather
 * than trusting a spoofable header directly exposed).
 */
export function rateKey(req: Request, scope: string): string {
  let ip = 'unknown';
  const trustedProxy = process.env.TRUSTED_PROXY;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    if (process.env.NODE_ENV !== 'production' || trustedProxy) {
      // Dev: always trust XFF (behind the gateway). Prod: trust only if configured.
      ip = xff.split(',')[0]!.trim();
    }
  }
  return `rl:${scope}:${ip}`;
}

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

/** Build a rate-limit key from the request + scope. */
export function rateKey(req: Request, scope: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return `rl:${scope}:${ip}`;
}

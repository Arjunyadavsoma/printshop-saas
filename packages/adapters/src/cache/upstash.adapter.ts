import type { CacheAdapter } from '@platform/core/interfaces';
import { Redis } from '@upstash/redis';

export interface UpstashConfig {
  url: string;
  token: string;
}

/**
 * Upstash Redis cache adapter (free 500K cmd/day, REST over HTTP).
 *
 * Backs rate limiting, idempotency keys, refresh-token jti revocation, and
 * payment-session mappings. All operations use the @upstash/redis REST client
 * (no persistent connection — works in serverless environments).
 *
 * Fail-closed: if Redis is unreachable, operations THROW (never silently
 * return null/0). This ensures rate limiting + idempotency don't silently
 * no-op when Redis is down — the request fails with 502 instead.
 *
 * In production: CACHE_PROVIDER=redis + REDIS_URL + REDIS_TOKEN.
 */
export class UpstashCacheAdapter implements CacheAdapter {
  readonly provider = 'redis';
  private readonly redis: Redis;

  constructor(config: UpstashConfig) {
    if (!config.url || !config.token) {
      throw new Error('UpstashCacheAdapter: url and token are required');
    }
    this.redis = new Redis({ url: config.url, token: config.token });
  }

  async get(key: string): Promise<string | null> {
    const val = await this.redis.get<string>(key);
    return val ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.set(key, value, { ex: ttlSeconds });
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incr(key: string): Promise<number> {
    // Upstash INCR returns the new value as a number.
    const val = await this.redis.incr(key);
    return typeof val === 'number' ? val : Number(val);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }
}

/**
 * Key-value cache abstraction. Used for rate-limit counters, idempotency
 * keys, and short-lived session data.
 *
 * Concrete implementations:
 *  - `UpstashCacheAdapter`   (free 500K cmds/mo, REST over HTTP)
 *  - `RedisCacheAdapter`    (self-hosted / ElastiCache)
 *  - `InMemoryCacheAdapter` (tests / single-process dev)
 */
export interface CacheAdapter {
  readonly provider: string;

  /** Get a string value, or `null` on miss. JSON decoding is the caller's job. */
  get(key: string): Promise<string | null>;

  /** Set a string value with an optional TTL (seconds). */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** Delete one key. Idempotent. */
  del(key: string): Promise<void>;

  /** Atomic increment — used by the rate limiter. */
  incr(key: string): Promise<number>;

  /** Set an expiry on an existing key (no-op if the key is absent). */
  expire(key: string, ttlSeconds: number): Promise<void>;
}

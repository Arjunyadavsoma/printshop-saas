import type { CacheAdapter } from '@platform/core/interfaces';

/** In-memory cache with TTL support — for tests and single-process dev. */
export class InMemoryCacheAdapter implements CacheAdapter {
  readonly provider = 'memory';
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string): Promise<number> {
    // Read the current value via get() — this handles the expired-key
    // case (deletes the entry + returns null if expired) so an incr on
    // an expired key correctly starts a fresh counter at 1.
    const current = Number((await this.get(key)) ?? '0');
    const next = current + 1;
    // Preserve the existing TTL — calling set() without a TTL arg would
    // reset `expiresAt` to null, causing the rate-limit counter to never
    // expire within the running process. Read the current entry (which
    // get() has already validated as non-expired, or undefined if the key
    // was just created/expired) and write the incremented value back with
    // the SAME expiresAt. The caller is responsible for setting the TTL
    // on a fresh key via expire() (e.g. the rate-limit code does
    // `if (count === 1) await cache.expire(key, windowSeconds)`).
    const existing = this.store.get(key);
    this.store.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (!entry) return;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }
}

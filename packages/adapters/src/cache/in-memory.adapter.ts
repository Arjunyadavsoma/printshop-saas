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
    const current = Number((await this.get(key)) ?? '0');
    const next = current + 1;
    await this.set(key, String(next));
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (!entry) return;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }
}

import { describe, expect, it, vi } from 'vitest';
import { rateLimit, rateKey } from './rate-limit';
import { RateLimitError } from '@platform/core/errors';

/** Minimal CacheAdapter stub for limiter behavior tests. */
function fakeCache(opts: { expireThrows?: boolean } = {}) {
  const store = new Map<string, number>();
  return {
    provider: 'memory-test',
    get: vi.fn(async (k: string) => String(store.get(k) ?? null)),
    set: vi.fn(async () => {}),
    del: vi.fn(async (k: string) => { store.delete(k); }),
    incr: vi.fn(async (k: string) => { store.set(k, (store.get(k) ?? 0) + 1); return store.get(k)!; }),
    expire: vi.fn(async (k: string, s: number) => {
      if (opts.expireThrows) throw new Error('adapter outage');
      void k; void s;
    }),
  };
}

describe('rateLimit — Phase 5 lost-expire regression', () => {
  it('counts and blocks over the limit within one window', async () => {
    const cache = fakeCache();
    for (let i = 0; i < 3; i++) await rateLimit(cache as never, 'rl:test:k1', 3, 60);
    await expect(rateLimit(cache as never, 'rl:test:k1', 3, 60)).rejects.toThrow(RateLimitError);
  });

  it('FAILS OPEN when expire cannot be set (no permanent lockout)', async () => {
    const cache = fakeCache({ expireThrows: true });
    // Must NOT throw despite the adapter outage: the counter is dropped.
    await expect(rateLimit(cache as never, 'rl:test:k2', 1, 60)).resolves.toBeDefined();
    expect(cache.del).toHaveBeenCalledWith('rl:test:k2');
    // Next request starts from a clean counter (del wiped it).
    await expect(rateLimit(cache as never, 'rl:test:k2', 1, 60)).resolves.toBeDefined();
  });

  it('rateKey keeps scope separation (unknown-IP buckets are not global)', () => {
    const req = new Request('http://localhost/x', { headers: {} });
    const a = rateKey(req as never, 'login', );
    const b = rateKey(req as never, 'register');
    expect(a).not.toBe(b);
    expect(a.startsWith('rl:login:')).toBe(true);
  });
});

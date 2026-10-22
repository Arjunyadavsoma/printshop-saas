import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { InMemoryCacheAdapter } from './in-memory.adapter';

/**
 * Regression tests for the InMemoryCacheAdapter — specifically the TTL
 * preservation bug in `incr()`.
 *
 * BUG (before fix): `incr()` called `set(key, String(next))` without a
 * TTL arg, which overwrote `expiresAt` to `null`. After the first incr,
 * the key never expired — breaking the rate-limit window reset.
 *
 * FIX: `incr()` now reads the current entry's `expiresAt` and writes
 * the incremented value back with the SAME `expiresAt`. New keys (or
 * keys that just expired via `get()`) start with `expiresAt: null` and
 * the caller is responsible for setting the TTL via `expire()`.
 */
describe('InMemoryCacheAdapter — TTL preservation in incr()', () => {
  let cache: InMemoryCacheAdapter;

  beforeEach(() => {
    cache = new InMemoryCacheAdapter();
  });

  describe('basic get/set/del', () => {
    it('set + get round-trips a value with no TTL (persists forever)', async () => {
      await cache.set('k', 'v');
      expect(await cache.get('k')).toBe('v');
    });

    it('set with TTL expires after the TTL', async () => {
      vi.useFakeTimers();
      await cache.set('k', 'v', 60);
      expect(await cache.get('k')).toBe('v');
      vi.advanceTimersByTime(59_999);
      expect(await cache.get('k')).toBe('v');
      vi.advanceTimersByTime(2); // total 60s + 1ms
      expect(await cache.get('k')).toBeNull();
    });

    it('del removes the key', async () => {
      await cache.set('k', 'v');
      await cache.del('k');
      expect(await cache.get('k')).toBeNull();
    });
  });

  describe('incr — TTL preservation (the bug)', () => {
    it('incr on a new key starts at 1 with no TTL (caller sets TTL via expire)', async () => {
      const n = await cache.incr('counter');
      expect(n).toBe(1);
      expect(await cache.get('counter')).toBe('1');
      // No TTL set yet — the caller must call expire().
      // (Simulate the rate-limit code: if count === 1, set TTL.)
      await cache.expire('counter', 60);
      // Verify the TTL was set.
      expect(await cache.get('counter')).toBe('1');
    });

    it('incr PRESERVES the existing TTL — the rate-limit window does not reset', async () => {
      // Simulate the rate-limit code: incr + expire on first call.
      const c1 = await cache.incr('rl:scope:ip');
      expect(c1).toBe(1);
      await cache.expire('rl:scope:ip', 60); // 60-second window

      vi.useFakeTimers();

      // Subsequent incrs within the window MUST preserve the original
      // expiresAt — they must NOT reset it to null (the bug).
      vi.advanceTimersByTime(10_000); // 10s elapsed
      const c2 = await cache.incr('rl:scope:ip');
      expect(c2).toBe(2);
      // The key should still expire at the ORIGINAL time (60s from t0, not
      // 60s from now). Verify by advancing to t0+59s — key should still be
      // present (1s left in the original window).
      vi.advanceTimersByTime(49_000); // total elapsed: 59s
      expect(await cache.get('rl:scope:ip')).toBe('2');
      // Advance past the original window (60s from t0).
      vi.advanceTimersByTime(2_000); // total elapsed: 61s
      expect(await cache.get('rl:scope:ip')).toBeNull();

      vi.useRealTimers();
    });

    it('incr on an EXPIRED key starts a fresh counter at 1', async () => {
      vi.useFakeTimers();
      // First window: counter reaches 3, then expires.
      expect(await cache.incr('k')).toBe(1);
      await cache.expire('k', 60);
      expect(await cache.incr('k')).toBe(2);
      expect(await cache.incr('k')).toBe(3);
      // Advance past the window.
      vi.advanceTimersByTime(61_000);
      expect(await cache.get('k')).toBeNull();

      // Second window: fresh start at 1.
      const c = await cache.incr('k');
      expect(c).toBe(1);
      // New TTL must be set by the caller (the previous TTL is gone).
      await cache.expire('k', 60);
      expect(await cache.get('k')).toBe('1');

      vi.useRealTimers();
    });

    it('repeated incr preserves the TTL across many increments', async () => {
      vi.useFakeTimers();
      // Setup: counter at 1 with 60s TTL.
      await cache.incr('counter');
      await cache.expire('counter', 60);

      // 19 more incrs (total 20 — the rate-limit threshold).
      for (let i = 2; i <= 20; i++) {
        vi.advanceTimersByTime(1_000); // 1s between each incr
        const c = await cache.incr('counter');
        expect(c).toBe(i);
      }

      // Total elapsed: 19s. The original window was 60s, so 41s remain.
      // Verify the counter is still present (NOT expired — the TTL was
      // preserved across all 19 incrs).
      expect(await cache.get('counter')).toBe('20');

      // Advance to 59s total — still within the original window.
      vi.advanceTimersByTime(40_000); // total: 59s
      expect(await cache.get('counter')).toBe('20');

      // Advance past the original window (60s from t0).
      vi.advanceTimersByTime(2_000); // total: 61s
      expect(await cache.get('counter')).toBeNull();

      vi.useRealTimers();
    });

    it('rate-limit simulation: 20 requests allowed, 21st rejected, window resets after TTL', async () => {
      // Simulates the actual rate-limit code in src/lib/api/rate-limit.ts.
      vi.useFakeTimers();

      const LIMIT = 20;
      const WINDOW = 60;

      async function tryRateLimit(): Promise<{ allowed: boolean; remaining: number }> {
        const count = await cache.incr('rl:create-order:ip');
        if (count === 1) {
          await cache.expire('rl:create-order:ip', WINDOW);
        }
        if (count > LIMIT) {
          return { allowed: false, remaining: 0 };
        }
        return { allowed: true, remaining: LIMIT - count };
      }

      // First 20 requests succeed.
      for (let i = 0; i < LIMIT; i++) {
        const r = await tryRateLimit();
        expect(r.allowed).toBe(true);
      }

      // 21st request is rejected (rate-limited).
      const blocked = await tryRateLimit();
      expect(blocked.allowed).toBe(false);

      // After 60s, the window resets — a new request succeeds.
      vi.advanceTimersByTime(61_000);
      const after = await tryRateLimit();
      expect(after.allowed).toBe(true);
      expect(after.remaining).toBe(LIMIT - 1); // 19 remaining

      vi.useRealTimers();
    });
  });

  describe('expire()', () => {
    it('expire on a non-existent key is a no-op', async () => {
      await cache.expire('nope', 60); // does not throw
      expect(await cache.get('nope')).toBeNull();
    });

    it('expire sets the TTL on an existing key', async () => {
      vi.useFakeTimers();
      await cache.set('k', 'v');
      await cache.expire('k', 30);
      vi.advanceTimersByTime(29_999);
      expect(await cache.get('k')).toBe('v');
      vi.advanceTimersByTime(2);
      expect(await cache.get('k')).toBeNull();
      vi.useRealTimers();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

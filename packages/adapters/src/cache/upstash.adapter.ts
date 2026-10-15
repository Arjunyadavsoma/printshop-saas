import type { CacheAdapter } from '@platform/core/interfaces';

/**
 * Upstash Redis adapter (free 500K commands/mo, REST over HTTP).
 *
 * PHASE-1 STATUS: skeleton — runtime wiring lands in Phase 2. The interface
 * is fixed; swapping for self-hosted Redis is a one-line config change.
 */
export class UpstashCacheAdapter implements CacheAdapter {
  readonly provider = 'upstash';
  constructor(private readonly config: { url: string; token: string }) {}

  async get(): Promise<string | null> {
    return null;
  }
  async set(): Promise<void> {}
  async del(): Promise<void> {}
  async incr(): Promise<number> {
    return 0;
  }
  async expire(): Promise<void> {}
}

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Phase 6.7 — Cron route auth-contract tests (reconcile-payments + cleanup).
 *
 * The Phase 6.7 security fix removed the `?secret=` query-string fallback
 * from BOTH cron routes. The secret MUST travel ONLY in the Authorization
 * header (Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`).
 * A secret in the URL would be logged by every proxy, Vercel's own logs, and
 * the application itself — it would also show up in browser history if anyone
 * ever invoked the cron manually.
 *
 * These tests verify the auth contract for both routes:
 *   1. Valid Bearer token → 200 (route executes)
 *   2. Missing Authorization header → 401
 *   3. Wrong token → 401
 *   4. Empty CRON_SECRET → 401 (fail-closed — if unset, NO token validates)
 *   5. ?secret= query param → 401 (rejected — no query fallback)
 *   6. Malformed Authorization header → 401 (e.g. "Token xxx", no Bearer prefix)
 *
 * Uses the shared Prisma-style mock + an InMemory container so the 200 case
 * can complete without hitting a real database.
 */

// Phase 6.7: use the shared Prisma-style mock so the route's `db` import is
// the test mock (no real DB connection). The mock's paymentAttempt Map is
// empty → findStalePaymentAttempts returns [] → the reconcile route returns
// 200 with zero stats. The cleanup route's processCleanupTasks swallows the
// missing FileCleanupTask table → also returns 200 with zero stats.
vi.mock('@/lib/db', async () => {
  const { getMockDb } = await import('@/lib/payments/test-prisma-mock');
  return { db: getMockDb() };
});

import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { resetMockDb } from '@/lib/payments/test-prisma-mock';
import {
  InMemoryDatabaseAdapter,
  InMemoryCacheAdapter,
  InMemoryStorageAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
  StubLoggerAdapter,
  UpiDeepLinkPaymentAdapter,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';

// ─── Test fixtures ─────────────────────────────────────────────────────

const CRON_SECRET = 'phase-6-7-cron-secret-test';

/** Build an InMemory container so routes can execute the 200 path safely. */
function buildContainer(): Container {
  const cache = new InMemoryCacheAdapter();
  return {
    db: new InMemoryDatabaseAdapter(),
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new JsonConsoleLogger({ service: 'cron-auth-test' }),
    auth: new JwtAuthAdapter(
      {
        accessSecret: 'test-access-secret-min-32-chars-long',
        refreshSecret: 'test-refresh-secret-min-32-chars-long',
        accessTtlSeconds: 900,
        refreshTtlSeconds: 2592000,
      },
      cache,
    ),
  };
}

beforeEach(() => {
  resetMockDb();
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  vi.stubEnv('SETUP_KEY', '');
  // The 200 case needs a container with all adapters wired.
  setContainerForTesting(buildContainer());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Helpers ───────────────────────────────────────────────────────────

/** Build a NextRequest with arbitrary headers + optional query string. */
function buildReq(opts: {
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}): NextRequest {
  const url = new URL(`http://localhost:3000${opts.path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    method: 'GET',
    headers: opts.headers ?? {},
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('GET /api/v1/cron/reconcile-payments — auth contract (Phase 6.7)', () => {
  const PATH = '/api/v1/cron/reconcile-payments';

  it('1. valid Bearer token → 200', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('2. missing Authorization header → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(buildReq({ path: PATH }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('3. wrong token → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: 'Bearer wrong-secret-value' } }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('4. empty CRON_SECRET → 401 (fail-closed — no SETUP_KEY fallback either)', async () => {
    // Unset both — the route MUST reject every token when no secret is configured.
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('SETUP_KEY', '');
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    // Even with the "correct" token, the empty secret → 401.
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(401);
  });

  it('5. ?secret= query param is REJECTED — no query-string fallback', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    // Pass the correct secret via ?secret= BUT no Authorization header → 401.
    // This proves the query fallback was removed.
    const res = await GET(
      buildReq({ path: PATH, query: { secret: CRON_SECRET } }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('6. ?secret= query with WRONG Authorization header → 401 (query is never consulted)', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    // Even if ?secret= is correct, the Authorization header MUST be valid.
    // The query string is no longer a fallback — wrong header wins.
    const res = await GET(
      buildReq({
        path: PATH,
        headers: { Authorization: 'Bearer wrong' },
        query: { secret: CRON_SECRET },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('7. malformed Authorization header (no "Bearer " prefix) → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: CRON_SECRET } }),
    );
    expect(res.status).toBe(401);
  });

  it('8. malformed Authorization header ("Token xxx" scheme) → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/reconcile-payments/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: `Token ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/cron/cleanup — auth contract (Phase 6.7)', () => {
  const PATH = '/api/v1/cron/cleanup';

  it('1. valid Bearer token → 200', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('2. missing Authorization header → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(buildReq({ path: PATH }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('3. wrong token → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: 'Bearer totally-wrong-secret' } }),
    );
    expect(res.status).toBe(401);
  });

  it('4. empty CRON_SECRET → 401 (fail-closed)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('SETUP_KEY', '');
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(401);
  });

  it('5. ?secret= query param is REJECTED — no query-string fallback', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(buildReq({ path: PATH, query: { secret: CRON_SECRET } }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('6. ?secret= query with WRONG Authorization header → 401 (query is never consulted)', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(
      buildReq({
        path: PATH,
        headers: { Authorization: 'Bearer nope' },
        query: { secret: CRON_SECRET },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('7. malformed Authorization header (no "Bearer " prefix) → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: CRON_SECRET } }),
    );
    expect(res.status).toBe(401);
  });

  it('8. malformed Authorization header ("Basic xxx" scheme) → 401', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(
      buildReq({ path: PATH, headers: { Authorization: `Basic ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(401);
  });
});

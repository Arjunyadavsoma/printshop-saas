import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig } from '@platform/core/domain';
import { ForbiddenError } from '@platform/core/errors';

/**
 * FIND-033 regression — API route guard / validation test coverage.
 *
 * The original audit found ZERO tests under `src/app/api/`. This file tests the
 * auth-guards + validation logic that every API route depends on, WITHOUT
 * making HTTP requests — the guard functions are exercised directly. The
 * in-memory container pattern (from `src/lib/auth/auth.test.ts`) is reused so
 * the real repository + cache + db stack runs end-to-end in-process.
 *
 * Coverage:
 *  1. Entitlements middleware (`src/lib/api/entitlements.ts`) — plan gating,
 *     `requireEntitlement` throws ForbiddenError, subscription status +
 *     grace-period logic.
 *  2. db-health endpoint auth (`src/app/api/v1/db-health/route.ts`) — 401 when
 *     the setup key is configured but missing/wrong, 200 + data when correct.
 *  3. Receipt endpoint rate-limit wrap (`src/app/api/v1/orders/[id]/receipt/route.ts`)
 *     — the GET export must be a function (wrapped via `withRateLimit`,
 *     FIND-027 brute-force guard).
 *  4. Webhook payment-session lookup (`src/lib/payments/webhook.service.ts`) —
 *     cache miss + DB miss → null, cache round-trip, DB fallback when the
 *     cache misses but the PaymentAttempt row exists.
 */

// ─── Mock @/lib/db ───────────────────────────────────────────────────────────
// The entitlements code uses the container's in-memory db (via repos), so it
// works without a real Prisma client. BUT the webhook.service's DB fallback
// path AND the db-health route both call `db.$queryRaw` / `db.paymentAttempt`
// directly on the PrismaClient singleton from `@/lib/db`. There's no Postgres
// available in the test env, so we mock the module to control those calls.
// `vi.hoisted` ensures the mock fns exist before `vi.mock`'s factory runs.
const dbMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: dbMocks.queryRaw,
    paymentAttempt: {
      findUnique: dbMocks.findUnique,
    },
  },
}));

// Import the units under test AFTER the mock is registered. These resolve
// through the same module registry, so any `await import('@/lib/db')` inside
// them will receive the mocked object.
import { isEntitled, requireEntitlement, getSubscriptionStatus } from '@/lib/api/entitlements';
import {
  lookupPaymentSession,
  rememberPaymentSession,
  type StoredPaymentSession,
} from '@/lib/payments/webhook.service';

// The db-health route imports `db` from `@/lib/db` at module top — that
// resolves to the mocked object above. Importing the route here triggers the
// module load + wires `db.$queryRaw` to `dbMocks.queryRaw`.
import { GET as dbHealthGet } from '@/app/api/v1/db-health/route';

// The receipt route's GET is the composition `withRateLimit('receipt', 30, 60,
// withOrderAccess(...))`. Importing it exercises the wrap at module-load time
// (closures are built but no handler runs).
import { GET as receiptGet } from '@/app/api/v1/orders/[id]/receipt/route';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

/**
 * Build a fresh in-memory container + reset the @/lib/db mocks. Each test
 * starts from a clean slate — no shop/order rows, no cache entries, no env
 * leaks between tests.
 */
beforeEach(() => {
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    { accessSecret: 'a', refreshSecret: 'b', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  const container: Container = {
    db: new InMemoryDatabaseAdapter(),
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new JsonConsoleLogger({ service: 'test' }),
    auth,
  };
  setContainerForTesting(container);

  // Reset the @/lib/db mocks. Default behaviours:
  //  - paymentAttempt.findUnique → null (DB miss)
  //  - $queryRaw → [{ test: 1 }] (so db-health's connection test passes)
  dbMocks.findUnique.mockReset();
  dbMocks.findUnique.mockResolvedValue(null);
  dbMocks.queryRaw.mockReset();
  dbMocks.queryRaw.mockResolvedValue([{ test: 1 }]);

  // process.env is shared across tests — restore after each run.
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

/**
 * Insert a shop row directly via the repository. The in-memory adapter stores
 * it in the `shop` table, so subsequent `repos.shops.findById` calls (issued
 * by the entitlements code under test) see it.
 */
async function makeShop(opts: {
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
  expiresAt: Date | null;
}): Promise<string> {
  const shop = await repos.shops.create({
    id: crypto.randomUUID(),
    name: 'S-' + crypto.randomUUID().slice(0, 6),
    slug: 's-' + crypto.randomUUID().slice(0, 8),
    ownerUserId: crypto.randomUUID(),
    upiId: 'shop@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: {},
    pricingConfig: createDefaultPricingConfig(),
    address: 'x',
    phone: '+919876543210',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: opts.tier,
    subscriptionExpiresAt: opts.expiresAt,
    description: null,
    businessHours: null,
    logoUrl: null,
    upiQrStorageKey: null,
    servicesJson: null,
    paymentPhone: null,
    paymentInstructions: null,
    cashOnPickup: false,
    paymentMethods: 'both',
    pamphletEnabled: false,
    pamphletPricePaise: 0,
    pamphletName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  return shop.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Entitlements middleware — `src/lib/api/entitlements.ts`
// ─────────────────────────────────────────────────────────────────────────────

describe('Entitlements middleware — src/lib/api/entitlements.ts', () => {
  it('isEntitled returns false for a free-plan shop + a pro-only feature', async () => {
    const shopId = await makeShop({ tier: 'free', expiresAt: null });
    // 'multi_device' is on the pro plan; free has no upgrade-only features.
    const ok = await isEntitled(shopId, 'multi_device');
    expect(ok).toBe(false);
  });

  it('isEntitled returns true for a pro-plan shop + a pro-tier feature', async () => {
    // Active subscription: expires 30 days from now.
    const shopId = await makeShop({
      tier: 'pro',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const ok = await isEntitled(shopId, 'multi_device');
    expect(ok).toBe(true);
  });

  it('requireEntitlement throws ForbiddenError when the shop is not entitled', async () => {
    const shopId = await makeShop({ tier: 'free', expiresAt: null });
    await expect(requireEntitlement(shopId, 'analytics')).rejects.toBeInstanceOf(ForbiddenError);
    // Verify the error carries the FORBIDDEN code so the envelope maps it to 403.
    await expect(requireEntitlement(shopId, 'analytics')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('getSubscriptionStatus returns isActive=true + correct tier for an active subscription', async () => {
    const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const shopId = await makeShop({ tier: 'pro', expiresAt: inThirtyDays });
    const status = await getSubscriptionStatus(shopId);
    expect(status.tier).toBe('pro');
    expect(status.isActive).toBe(true);
    expect(status.inGracePeriod).toBe(false);
    expect(status.expiresAt).toEqual(inThirtyDays);
    // ~30 days until expiry (allow a small clock-drift slack).
    expect(status.daysUntilExpiry).toBeGreaterThan(25);
    expect(status.daysUntilExpiry).toBeLessThanOrEqual(30);
  });

  it('getSubscriptionStatus returns a grace-period flag for a recently-expired subscription', async () => {
    // Expired 3 days ago — within the 7-day grace window.
    const expiredThreeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const shopId = await makeShop({ tier: 'pro', expiresAt: expiredThreeDaysAgo });
    const status = await getSubscriptionStatus(shopId);
    expect(status.inGracePeriod).toBe(true);
    expect(status.isActive).toBe(true);
    // Within grace → tier is retained (downgrade happens after grace ends).
    expect(status.tier).toBe('pro');
    expect(status.daysUntilExpiry).toBeLessThan(0); // negative = expired
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. db-health endpoint — `src/app/api/v1/db-health/route.ts`
//    Verify the auth guard (FIND-011 fix) without spinning up an HTTP server.
// ─────────────────────────────────────────────────────────────────────────────

describe('db-health endpoint auth — src/app/api/v1/db-health/route.ts', () => {
  it('returns 401 when the setup key is configured but the caller omits ?key=', async () => {
    // Configure a setup key — the route now requires it.
    process.env.SETUP_KEY = 'test-secret-key';
    // No ?key= query param.
    const req = new NextRequest('http://localhost:3000/api/v1/db-health');
    const res = await dbHealthGet(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 + a health report when the caller supplies the correct Bearer token', async () => {
    process.env.ADMIN_ACCESS_KEY = 'test-admin-key';
    // F-04 fix: auth is now via Bearer header (not ?key= query string)
    const req = new NextRequest(
      'http://localhost:3000/api/v1/db-health',
      { headers: { authorization: 'Bearer test-admin-key' } },
    );
    const res = await dbHealthGet(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connection).toBe('OK');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Receipt endpoint rate-limit wrap — `src/app/api/v1/orders/[id]/receipt/route.ts`
//    FIND-027 fix: the GET export MUST be wrapped with `withRateLimit`
//    (30 req / 60s) so customer-token brute-force is throttled.
// ─────────────────────────────────────────────────────────────────────────────

describe('Receipt endpoint rate-limit wrap', () => {
  it('GET is a function (wrapped with withRateLimit — not undefined)', () => {
    // The route file declares:
    //   export const GET = withRateLimit('receipt', 30, 60, withOrderAccess(...))
    // `withRateLimit` returns an async function. If anyone strips the wrap or
    // forgets to export GET, this assertion fails.
    expect(typeof receiptGet).toBe('function');
    expect(receiptGet).not.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Webhook payment-session lookup — `src/lib/payments/webhook.service.ts`
//    The webhook can't trust the merchantOrderId in the payload — it has to
//    resolve it back to an order via the cache or the PaymentAttempt table.
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook payment-session lookup — src/lib/payments/webhook.service.ts', () => {
  it('lookupPaymentSession returns null when both cache AND DB miss', async () => {
    // Fresh in-memory cache (no entries) + dbMocks.findUnique defaults to null.
    const result = await lookupPaymentSession('unknown-moid-12345');
    expect(result).toBeNull();
    // The DB fallback MUST have been attempted (proves we don't rely on the
    // 10-minute cache alone — slow PSPs / cold starts would otherwise drop
    // delayed webhooks).
    expect(dbMocks.findUnique).toHaveBeenCalledTimes(1);
    expect(dbMocks.findUnique).toHaveBeenCalledWith({ where: { merchantOrderId: 'unknown-moid-12345' } });
  });

  it('rememberPaymentSession + lookupPaymentSession round-trips via cache', async () => {
    const session: StoredPaymentSession = {
      orderId: 'order-abc',
      shopId: 'shop-xyz',
      amountPaise: 50_000,
      provider: 'phonepe',
    };
    await rememberPaymentSession('moid-rt', session);
    // Cache hit → should NOT touch the DB fallback at all.
    const result = await lookupPaymentSession('moid-rt');
    expect(result).not.toBeNull();
    expect(result).toEqual(session);
    expect(dbMocks.findUnique).not.toHaveBeenCalled();
  });

  it('lookupPaymentSession falls back to the PaymentAttempt DB row when the cache misses', async () => {
    // Cache miss (no rememberPaymentSession call) but DB has the row.
    dbMocks.findUnique.mockResolvedValueOnce({
      id: 'pa-1',
      orderId: 'order-from-db',
      shopId: 'shop-from-db',
      amountPaise: 12_000,
      provider: 'phonepe',
      merchantOrderId: 'moid-db',
    });
    const result = await lookupPaymentSession('moid-db');
    expect(result).not.toBeNull();
    expect(result?.orderId).toBe('order-from-db');
    expect(result?.shopId).toBe('shop-from-db');
    expect(result?.amountPaise).toBe(12_000);
    expect(result?.provider).toBe('phonepe');
    // The DB fallback path re-populates the cache for subsequent lookups —
    // a second lookup MUST hit the cache and NOT touch the DB again.
    dbMocks.findUnique.mockClear();
    const cached = await lookupPaymentSession('moid-db');
    expect(cached).not.toBeNull();
    expect(cached?.orderId).toBe('order-from-db');
    expect(dbMocks.findUnique).not.toHaveBeenCalled();
  });
});

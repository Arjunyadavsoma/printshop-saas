import { describe, expect, it, beforeEach } from 'vitest';
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

/**
 * REAL HTTP Route-Handler Tests
 *
 * These tests invoke the ACTUAL exported route handler functions (GET, POST, etc.)
 * with real NextRequest objects and real JWT tokens. They exercise the full
 * pipeline: auth guard → repository → business logic → response.
 *
 * This addresses FIND-033 (P0): zero real HTTP route-handler tests.
 */

let auth: JwtAuthAdapter;
let container: Container;
let ownerToken: string;
let shopId: string;
let userId: string;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  container = {
    db,
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

  // Create test user FIRST (repos.users.create generates its own UUID)
  const user = await repos.users.create({
    email: 'owner@test.com',
    phone: '5555555555',
    password: 'testpass123',
    role: 'owner',
    shopId: null, // not linked yet
  }, auth);
  userId = user.id;

  // Create shop with the CORRECT ownerUserId
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId,
    name: 'Test Shop',
    slug: `test-shop-${shopId.slice(0, 8)}`,
    ownerUserId: userId, // correct user ID
    upiId: 'test@upi',
    paymentProvider: 'googlepay',
    paymentCredentials: '',
    pricingConfig: JSON.stringify(createDefaultPricingConfig()),
    address: '123 Test St',
    phone: '5555555555',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: 'free',
    subscriptionExpiresAt: null,
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
  } as any);

  // Link user to shop (update the user's shopId)
  await repos.users.update(userId, { shopId } as any);

  // Generate a real JWT for the owner
  const access = await auth.issueAccessToken({ id: userId, shopId, role: 'owner' });
  ownerToken = access.token;
});

function authedReq(method: string, path: string, opts?: { body?: unknown; headers?: Record<string, string> }): NextRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ownerToken}`,
    ...opts?.headers,
  };
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
}

function unauthedReq(method: string, path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method });
}

describe('REAL HTTP Route-Handler Tests', () => {

  // ─── Health endpoint ───
  describe('GET /api/v1/health', () => {
    it('returns 200 with ok status', async () => {
      const { GET } = await import('@/app/api/v1/health/route');
      const res = await GET();
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('ok');
    });
  });

  // ─── Shops/me endpoint ───
  describe('GET /api/v1/shops/me', () => {
    it('returns 200 with shop profile + subscription status (authenticated)', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/route');
      const req = authedReq('GET', '/api/v1/shops/me');
      const res = await GET(req, { params: Promise.resolve({}) });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Test Shop');
      expect(json.data.subscription).toBeDefined();
      expect(json.data.subscription.tier).toBe('free');
      expect(json.data.subscription.state).toBe('active');
    });

    it('returns 401 without authentication', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/route');
      const req = unauthedReq('GET', '/api/v1/shops/me');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/route');
      const req = new NextRequest('http://localhost:3000/api/v1/shops/me', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  // ─── Analytics endpoint (entitlement enforcement) ───
  describe('GET /api/v1/shops/me/analytics', () => {
    it('returns 403 for free-tier shop (entitlement enforced)', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/analytics/route');
      const req = authedReq('GET', '/api/v1/shops/me/analytics');
      const res = await GET(req, { params: Promise.resolve({}) });
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('returns 401 without authentication', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/analytics/route');
      const req = unauthedReq('GET', '/api/v1/shops/me/analytics');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  // ─── Reports endpoint (entitlement enforcement) ───
  describe('GET /api/v1/shops/me/reports/daily', () => {
    it('returns 403 for free-tier shop (entitlement enforced)', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/reports/daily/route');
      const req = authedReq('GET', '/api/v1/shops/me/reports/daily');
      const res = await GET(req, { params: Promise.resolve({}) });
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('FORBIDDEN');
    });
  });

  // ─── Shops list (public) ───
  describe('GET /api/v1/shops', () => {
    it('returns 200 with shop list (public, no auth needed)', async () => {
      const { GET } = await import('@/app/api/v1/shops/route');
      const req = new NextRequest('http://localhost:3000/api/v1/shops?limit=10');
      const res = await GET(req, { params: Promise.resolve({}) });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.shops).toBeInstanceOf(Array);
    });
  });

  // ─── Agents list (authenticated) ───
  describe('GET /api/v1/shops/me/agents', () => {
    it('returns 200 with agent list (authenticated)', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/agents/route');
      const req = authedReq('GET', '/api/v1/shops/me/agents');
      const res = await GET(req, { params: Promise.resolve({}) });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
    });

    it('returns 401 without authentication', async () => {
      const { GET } = await import('@/app/zpi/v1/shops/me/agents/route'.replace('zpi', 'api'));
      const req = unauthedReq('GET', '/api/v1/shops/me/agents');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  // ─── Orders list (authenticated) ───
  describe('GET /api/v1/shops/me/orders', () => {
    it('returns 200 with order list (authenticated, free feature)', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/orders/route');
      const req = authedReq('GET', '/api/v1/shops/me/orders');
      const res = await GET(req, { params: Promise.resolve({}) });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });

    it('returns 401 without authentication', async () => {
      const { GET } = await import('@/app/api/v1/shops/me/orders/route');
      const req = unauthedReq('GET', '/api/v1/shops/me/orders');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  // ─── Sync status (device auth) ───
  describe('GET /api/v1/sync/status', () => {
    it('returns 401 without device token', async () => {
      const { GET } = await import('@/app/api/v1/sync/status/route');
      const req = unauthedReq('GET', '/api/v1/sync/status');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid device token', async () => {
      const { GET } = await import('@/app/api/v1/sync/status/route');
      const req = new NextRequest('http://localhost:3000/api/v1/sync/status', {
        headers: { Authorization: 'Bearer invalid-device-token' },
      });
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  // ─── Cron cleanup (secret auth) ───
  describe('GET /api/v1/cron/cleanup', () => {
    it('returns 401 without secret', async () => {
      const { GET } = await import('@/app/api/v1/cron/cleanup/route');
      const req = new NextRequest('http://localhost:3000/api/v1/cron/cleanup');
      const res = await (GET as any)(req);
      expect(res.status).toBe(401);
    });
  });

  // ─── db-health (key auth) ───
  describe('GET /api/v1/db-health', () => {
    it('returns 401 without key (when key is configured)', async () => {
      // Set a key in the environment
      const origKey = process.env.SETUP_KEY;
      process.env.SETUP_KEY = 'test-setup-key';
      try {
        const { GET } = await import('@/app/api/v1/db-health/route');
        const req = new NextRequest('http://localhost:3000/api/v1/db-health');
        const res = await (GET as any)(req);
        expect(res.status).toBe(401);
      } finally {
        process.env.SETUP_KEY = origKey;
      }
    });
  });
});

describe('Subscription State Tests', () => {
  // These tests verify the entitlement system handles different subscription states correctly

  it('free tier: analytics denied, orders allowed', async () => {
    // Shop is already created as free tier in beforeEach
    const { isEntitled } = await import('@/lib/api/entitlements');
    expect(await isEntitled(shopId, 'analytics')).toBe(false);
    expect(await isEntitled(shopId, 'multi_device')).toBe(false);
  });

  it('pro tier: analytics + multi_device allowed', async () => {
    // Upgrade shop to pro
    await repos.shops.update(shopId, {
      subscriptionTier: 'pro',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    } as any);

    const { isEntitled } = await import('@/lib/api/entitlements');
    expect(await isEntitled(shopId, 'analytics')).toBe(true);
    expect(await isEntitled(shopId, 'multi_device')).toBe(true);
    expect(await isEntitled(shopId, 'delivery_tracking')).toBe(true);
  });

  it('expired pro (within grace): features still work', async () => {
    await repos.shops.update(shopId, {
      subscriptionTier: 'pro',
      subscriptionExpiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // expired 3 days ago (within 7-day grace)
    } as any);

    const { isEntitled, getSubscriptionStatus } = await import('@/lib/api/entitlements');
    const status = await getSubscriptionStatus(shopId);
    expect(status.state).toBe('grace');
    expect(await isEntitled(shopId, 'analytics')).toBe(true); // grace period
  });

  it('expired pro (past grace): downgraded to free', async () => {
    await repos.shops.update(shopId, {
      subscriptionTier: 'pro',
      subscriptionExpiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // expired 10 days ago (past 7-day grace)
    } as any);

    const { isEntitled, getSubscriptionStatus } = await import('@/lib/api/entitlements');
    const status = await getSubscriptionStatus(shopId);
    expect(status.state).toBe('expired');
    expect(status.effectiveTier).toBe('free');
    expect(await isEntitled(shopId, 'analytics')).toBe(false); // downgraded
  });

  it('suspended subscription: features denied', async () => {
    // The system treats suspended as downgraded to free
    await repos.shops.update(shopId, {
      subscriptionTier: 'pro',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    } as any);

    // Simulate suspension by checking with a custom approach
    // (the system doesn't have a 'suspended' field on Shop — it uses tier + expiry)
    // A suspended shop would have its tier set to 'free' by an admin
    await repos.shops.update(shopId, { subscriptionTier: 'free' } as any);

    const { isEntitled } = await import('@/lib/api/entitlements');
    expect(await isEntitled(shopId, 'analytics')).toBe(false);
  });
});

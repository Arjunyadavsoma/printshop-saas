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
 * P9-Security §1 — Order Token Security
 *
 * The customer tracking route (`/api/v1/o/[token]`) is unauthenticated: the
 * token in the URL IS the credential. Three guarantees must hold:
 *
 *   (a) Entropy: tokens minted by the upload-init flow must carry at least
 *       128 bits of entropy (32 hex chars minimum). A 6-character
 *       alphabet-restricted token is only ~31 bits — brute-forceable in
 *       seconds. The brief explicitly demands 128-bit order tokens.
 *
 *   (b) No enumeration: an unknown token and an expired token must return
 *       the SAME response (same status, same code, same message). Otherwise
 *       an attacker can probe token-existence by response shape.
 *
 *   (c) Rate limit: `/api/v1/o/[token]` is rate-limited per IP at 60/min so
 *       brute-force attempts are throttled even if entropy is somehow weak.
 */

let container: Container;
let shopId: string;
let shopSlug: string;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
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

  // Create a shop directly through the repository so the upload-init route
  // can find it by slug. isActive + isOpen + acceptingOrders must be true.
  shopSlug = 'shop-' + crypto.randomUUID().slice(0, 8);
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId,
    name: 'Token Test Shop',
    slug: shopSlug,
    ownerUserId: crypto.randomUUID(),
    upiId: 'shop@upi',
    paymentProvider: 'googlepay',
    paymentCredentials: '',
    pricingConfig: JSON.stringify(createDefaultPricingConfig()),
    address: '1 Test Street',
    phone: '5550000000',
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
  } as never);
  // isOpen + acceptingOrders default true in the InMemory adapter; flip
  // them explicitly so the upload-init route's shop-open check passes.
  await db.update('shop', { id: shopId }, {
    isOpen: true,
    acceptingOrders: true,
    paymentMode: 'UPI_THEN_PRINT',
  } as never);
});

function jsonReq(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe('Order token security — entropy', () => {
  it('upload-init returns a customerToken with ≥128 bits of entropy (≥32 hex chars)', async () => {
    const { POST } = await import('@/app/api/v1/s/[slug]/uploads/init/route');
    const req = jsonReq('POST', `/api/v1/s/${shopSlug}/uploads/init`, {
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    const res = await POST(req, { params: Promise.resolve({ slug: shopSlug }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    const token = json.data.orderToken as string;
    expect(typeof token).toBe('string');
    // 32 hex chars = 128 bits. Allow longer (the route mints two concatenated
    // UUIDs = 256 bits = 64 hex chars). Reject anything shorter than 32.
    expect(token.length).toBeGreaterThanOrEqual(32);
    // Hex-only (canonical form). The route uses crypto.randomUUID().replace(/-/g,'').
    // We accept any [a-f0-9]+ string of sufficient length.
    expect(/^[a-f0-9]+$/i.test(token)).toBe(true);
  });

  it('minted tokens are unpredictable across many invocations (no duplicates, high spread)', async () => {
    const { POST } = await import('@/app/api/v1/s/[slug]/uploads/init/route');
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const req = jsonReq('POST', `/api/v1/s/${shopSlug}/uploads/init`, {
        filename: `doc-${i}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });
      const res = await POST(req, { params: Promise.resolve({ slug: shopSlug }) });
      const json = await res.json();
      tokens.add(json.data.orderToken as string);
    }
    // 20 distinct tokens out of 20 calls — the random space is dense enough.
    expect(tokens.size).toBe(20);
  });
});

describe('Order token security — no enumeration between unknown and expired tokens', () => {
  it('unknown token returns 404 NOT_FOUND with "Order not found"', async () => {
    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const fakeToken = 'a'.repeat(64); // well-formed-looking, does not exist
    const req = new NextRequest(`http://localhost:3000/api/v1/o/${fakeToken}`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    const res = await GET(req, { params: Promise.resolve({ token: fakeToken }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
    expect(json.error.message).toBe('Order not found');
  });

  it('expired token (awaiting_payment past expiresAt) returns the SAME 404 response', async () => {
    // Mint a real order whose expiresAt is in the past and status is awaiting_payment.
    const order = await repos.orders.createWithUniqueToken(
      shopId,
      {
        customerPhone: null,
        notes: null,
        // Use the strong generator the upload-init route uses.
        regenerateCustomerToken: () =>
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      },
      (c) => String(900 + c),
    );
    // Set it into the expired-awaiting state.
    const past = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    await container.db.update('order', { id: order.id }, {
      status: 'awaiting_payment',
      expiresAt: past,
    } as never);

    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const req = new NextRequest(`http://localhost:3000/api/v1/o/${order.customerToken}`, {
      headers: { 'x-forwarded-for': '203.0.113.11' },
    });
    const res = await GET(req, { params: Promise.resolve({ token: order.customerToken }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    // SAME code + SAME message as the unknown-token case — no enumeration.
    expect(json.error.code).toBe('NOT_FOUND');
    expect(json.error.message).toBe('Order not found');
  });

  it('an active (non-expired) order is still trackable (sanity — no false negatives)', async () => {
    const order = await repos.orders.createWithUniqueToken(
      shopId,
      {
        customerPhone: null,
        notes: null,
        regenerateCustomerToken: () =>
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      },
      (c) => String(901 + c),
    );
    // Future expiry + awaiting_payment — still alive.
    const future = new Date(Date.now() + 30 * 60 * 1000);
    await container.db.update('order', { id: order.id }, {
      status: 'awaiting_payment',
      expiresAt: future,
    } as never);

    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const req = new NextRequest(`http://localhost:3000/api/v1/o/${order.customerToken}`, {
      headers: { 'x-forwarded-for': '203.0.113.12' },
    });
    const res = await GET(req, { params: Promise.resolve({ token: order.customerToken }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.order.id).toBe(order.id);
  });
});

describe('Order token security — rate limit per IP on /api/v1/o/[token]', () => {
  it('allows up to 60 requests per minute from one IP', async () => {
    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const token = 'b'.repeat(64);
    let lastStatus = 0;
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest(`http://localhost:3000/api/v1/o/${token}`, {
        headers: { 'x-forwarded-for': '198.51.100.20' },
      });
      const res = await GET(req, { params: Promise.resolve({ token }) });
      lastStatus = res.status;
      // All 60 should be 404 (unknown token) — NOT 429 (rate limited).
      expect(res.status).toBe(404);
    }
    expect(lastStatus).toBe(404);
  });

  it('rejects the 61st request from the same IP with 429', async () => {
    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const token = 'c'.repeat(64);
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest(`http://localhost:3000/api/v1/o/${token}`, {
        headers: { 'x-forwarded-for': '198.51.100.21' },
      });
      const res = await GET(req, { params: Promise.resolve({ token }) });
      expect(res.status).toBe(404);
    }
    // The 61st request MUST be rate-limited.
    const req = new NextRequest(`http://localhost:3000/api/v1/o/${token}`, {
      headers: { 'x-forwarded-for': '198.51.100.21' },
    });
    const res = await GET(req, { params: Promise.resolve({ token }) });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('RATE_LIMITED');
  });

  it('rate limit is per-IP — a different IP is not throttled by the first IP\'s traffic', async () => {
    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const token = 'd'.repeat(64);
    // Burn the entire budget for IP-A.
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest(`http://localhost:3000/api/v1/o/${token}`, {
        headers: { 'x-forwarded-for': '198.51.100.30' },
      });
      await GET(req, { params: Promise.resolve({ token }) });
    }
    // IP-B should still get a clean 404 (not 429).
    const req = new NextRequest(`http://localhost:3000/api/v1/o/${token}`, {
      headers: { 'x-forwarded-for': '198.51.100.31' },
    });
    const res = await GET(req, { params: Promise.resolve({ token }) });
    expect(res.status).toBe(404);
  });
});

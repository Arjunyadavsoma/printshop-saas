import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Status endpoint regression tests — verify the GET
 * /api/v1/orders/:id/status response NEVER includes `customerToken`.
 *
 * CONTEXT (P0-01 fix, phase-6): the status route used to echo the order's
 * `customerToken` back in the JSON body. The caller already possesses the
 * token (they authenticated with it via the X-Order-Token header or ?t= query),
 * so returning it was redundant AND risked leaking the bearer secret in:
 *  - logged responses (any logger between the route + the client saw it),
 *  - browser devtools network panels,
 *  - screenshots / support tickets.
 *
 * The handler was refactored to omit the field entirely. These tests guard
 * against a regression where someone re-adds it (e.g. for a "show token" debug
 * feature) — a single field added back would silently leak the bearer secret
 * to every status poll.
 *
 * Pattern is copied from `src/lib/api/payment-route-tests.test.ts`:
 *  - vi.mock('@/lib/db') at the top of the file (hoisted).
 *  - InMemoryDatabaseAdapter + InMemoryStorageAdapter via
 *    `setContainerForTesting()`.
 *  - shop + order created via `repos.shops.create()` + `repos.orders.create()`.
 *  - customer-token authentication via the `X-Order-Token` header.
 */

vi.mock('@/lib/db', async () => {
  const { getMockDb } = await import('@/lib/payments/test-prisma-mock');
  return { db: getMockDb() };
});

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
import { createDefaultPricingConfig, type Shop } from '@platform/core/domain';
import { resetMockDb } from '@/lib/payments/test-prisma-mock';

// ── Per-test state (reset in beforeEach) ──
let container: Container;
let shopId: string;
let orderId: string;
let customerToken: string;

beforeEach(async () => {
  resetMockDb();

  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    {
      accessSecret: 'test-access-secret-min-32-chars-long',
      refreshSecret: 'test-refresh-secret-min-32-chars-long',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 2592000,
    },
    cache,
  );
  container = {
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

  // ── Shop + owner ──
  const owner = await repos.users.create({
    email: 'owner@test.com',
    phone: '5555555555',
    password: 'testpass123',
    role: 'owner',
    shopId: null,
  }, auth);

  shopId = crypto.randomUUID();
  const shop: Shop = {
    id: shopId,
    name: 'Test Shop',
    slug: `test-shop-${shopId.slice(0, 8)}`,
    ownerUserId: owner.id,
    upiId: 'shop@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: {},
    pricingConfig: createDefaultPricingConfig(),
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await repos.shops.create(shop);
  await repos.users.update(owner.id, { shopId });

  // ── Order awaiting payment ──
  customerToken = 'TOK' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const order = await repos.orders.create({ shopId, customerToken });
  orderId = order.id;
});

describe('GET /api/v1/orders/:id/status — customerToken never leaked in response', () => {
  it('1. the JSON response body MUST NOT contain a `customerToken` field', async () => {
    const { GET } = await import('@/app/api/v1/orders/[id]/status/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/status`,
      { method: 'GET', headers: { 'X-Order-Token': customerToken } },
    );
    const res = await GET(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // ── The load-bearing assertion: the bearer secret must NOT be in the body. ──
    expect(json.data).not.toHaveProperty('customerToken');
    // Also guard against a nested leak (e.g. inside a meta or files entry).
    expect(JSON.stringify(json)).not.toContain(customerToken);

    // Sanity: the legitimate status fields ARE present.
    expect(json.data.orderId).toBe(orderId);
    expect(json.data.status).toBe('awaiting_payment');
    expect(json.data.totalAmountPaise).toBe(0);
    expect(json.data.files).toEqual([]);
  });

  it('2. a paid order with files still omits customerToken (no field creep on rich responses)', async () => {
    // Add a file + flip the order to paid so the response carries more fields.
    const file = await repos.files.create({
      orderId,
      originalFilename: 'doc.pdf',
      storageKey: `shops/${shopId}/orders/${orderId}/file-1`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      pageCount: 1,
    });
    await repos.files.update(file.id, { pricePaise: 10000 });
    await repos.orders.update(orderId, {
      status: 'paid',
      totalAmountPaise: 10000,
      paymentTxnId: 'txn-123',
      paymentUtr: 'UTR-123',
      paidAt: new Date(),
    });

    const { GET } = await import('@/app/api/v1/orders/[id]/status/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/status`,
      { method: 'GET', headers: { 'X-Order-Token': customerToken } },
    );
    const res = await GET(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).not.toHaveProperty('customerToken');
    expect(JSON.stringify(json)).not.toContain(customerToken);

    // The richer response still surfaces the paid fields + the file summary.
    expect(json.data.status).toBe('paid');
    expect(json.data.paidAt).toBeTruthy();
    expect(json.data.paymentTxnId).toBe('txn-123');
    expect(json.data.files).toHaveLength(1);
    expect(json.data.files[0]!.filename).toBe('doc.pdf');
    // `files` entries must also not surface the storageKey (a separate
    // defence-in-depth concern — the storageKey is the path to the raw
    // document and should never reach the customer).
    expect(json.data.files[0]).not.toHaveProperty('storageKey');
  });

  it('3. returns 403 when the X-Order-Token is missing (no existence leak via 200)', async () => {
    const { GET } = await import('@/app/api/v1/orders/[id]/status/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/status`,
      { method: 'GET' },
    );
    const res = await GET(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
    // The body must not contain the order id OR the token (no leak via error).
    expect(JSON.stringify(json)).not.toContain(customerToken);
  });
});

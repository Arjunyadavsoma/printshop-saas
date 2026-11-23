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
 * P9-Security §2 — IDOR cross-tenant test
 *
 * The customer flow stores files against draft orders. The file-status
 * endpoint (`GET /api/v1/s/[slug]/files/[fileId]?token=<orderToken>`) is
 * the only customer-facing accessor for a file's metadata + thumbnails.
 *
 * Acceptance criteria:
 *   - Order A belongs to Shop X with token A.
 *   - Order B belongs to Shop Y with token B.
 *   - Fetching Order A's file using Order B's token MUST fail (404).
 *   - Fetching Order A's file from Shop Y's URL (wrong shop slug) MUST fail
 *     even with Order A's correct token.
 *   - Fetching Order A's file from Shop X's URL with Order A's token MUST
 *     succeed (sanity — legitimate access still works).
 *
 * All failures must be 404, never 403 — a 403 would confirm the file EXISTS,
 * which is itself an information leak.
 */

let container: Container;

let shopXId: string;
let shopXSlug: string;
let orderAId: string;
let orderAToken: string;
let fileAId: string;

let shopYId: string;
let shopYSlug: string;
let orderBId: string;
let orderBToken: string;
let fileBId: string;

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
    logger: new StubLoggerAdapter(),
    auth,
  };
  setContainerForTesting(container);

  async function makeShop(name: string): Promise<{ id: string; slug: string }> {
    const id = crypto.randomUUID();
    const slug = name.toLowerCase().replace(/\s+/g, '-') + '-' + id.slice(0, 8);
    await repos.shops.create({
      id,
      name,
      slug,
      ownerUserId: crypto.randomUUID(),
      upiId: 'shop@upi',
      paymentProvider: 'googlepay',
      paymentCredentials: '',
      pricingConfig: JSON.stringify(createDefaultPricingConfig()),
      address: '1 Test St',
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
    await db.update('shop', { id }, {
      isOpen: true,
      acceptingOrders: true,
      paymentMode: 'UPI_THEN_PRINT',
    } as never);
    return { id, slug };
  }

  // ── Shop X with Order A + File A ──
  const x = await makeShop('ShopX');
  shopXId = x.id;
  shopXSlug = x.slug;
  const orderA = await repos.orders.createWithUniqueToken(
    shopXId,
    {
      customerPhone: null,
      notes: null,
      regenerateCustomerToken: () =>
        crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    },
    (c) => String(100 + c),
  );
  orderAId = orderA.id;
  orderAToken = orderA.customerToken;
  const fileA = await repos.files.create({
    orderId: orderAId,
    originalFilename: 'private-doc.pdf',
    storageKey: `shops/${shopXId}/orders/${orderAId}/orig/${crypto.randomUUID()}_private-doc.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pageCount: 1,
    status: 'ready',
  });
  fileAId = fileA.id;

  // ── Shop Y with Order B + File B ──
  const y = await makeShop('ShopY');
  shopYId = y.id;
  shopYSlug = y.slug;
  const orderB = await repos.orders.createWithUniqueToken(
    shopYId,
    {
      customerPhone: null,
      notes: null,
      regenerateCustomerToken: () =>
        crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    },
    (c) => String(200 + c),
  );
  orderBId = orderB.id;
  orderBToken = orderB.customerToken;
  const fileB = await repos.files.create({
    orderId: orderBId,
    originalFilename: 'private-doc.pdf',
    storageKey: `shops/${shopYId}/orders/${orderBId}/orig/${crypto.randomUUID()}_private-doc.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pageCount: 1,
    status: 'ready',
  });
  fileBId = fileB.id;
});

function fileReq(slug: string, fileId: string, token: string): NextRequest {
  const url = `http://localhost:3000/api/v1/s/${slug}/files/${fileId}?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { headers: { 'x-forwarded-for': '203.0.113.99' } });
}

describe('IDOR — cross-tenant file access via /api/v1/s/[slug]/files/[fileId]', () => {
  it('Shop X customer can read their own file (sanity)', async () => {
    const { GET } = await import('@/app/api/v1/s/[slug]/files/[fileId]/route');
    const res = await GET(fileReq(shopXSlug, fileAId, orderAToken), {
      params: Promise.resolve({ slug: shopXSlug, fileId: fileAId }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.fileId).toBe(fileAId);
  });

  it('Order B token cannot read Order A file (cross-tenant token swap)', async () => {
    const { GET } = await import('@/app/api/v1/s/[slug]/files/[fileId]/route');
    // Same shop slug (X) + same file (A) but Order B's token.
    const res = await GET(fileReq(shopXSlug, fileAId, orderBToken), {
      params: Promise.resolve({ slug: shopXSlug, fileId: fileAId }),
    });
    expect(res.status).toBe(404); // NOT 403 — file existence must not leak.
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('Order A token cannot read Order B file (reverse direction)', async () => {
    const { GET } = await import('@/app/api/v1/s/[slug]/files/[fileId]/route');
    const res = await GET(fileReq(shopYSlug, fileBId, orderAToken), {
      params: Promise.resolve({ slug: shopYSlug, fileId: fileBId }),
    });
    expect(res.status).toBe(404);
  });

  it('Order A token + Shop Y slug + File A id — wrong-shop slug is rejected', async () => {
    const { GET } = await import('@/app/api/v1/s/[slug]/files/[fileId]/route');
    // Even with the right token + right file id, the shop slug must match
    // the order's actual shop. Otherwise a customer who knows another shop's
    // slug + a leaked file id cannot pull the file through the wrong URL.
    const res = await GET(fileReq(shopYSlug, fileAId, orderAToken), {
      params: Promise.resolve({ slug: shopYSlug, fileId: fileAId }),
    });
    expect(res.status).toBe(404);
  });

  it('Order A token + Shop X slug + Order A\'s file via Shop Y URL — file id from foreign shop is rejected', async () => {
    const { GET } = await import('@/app/api/v1/s/[slug]/files/[fileId]/route');
    // Shop X customer tries to fetch Shop Y's file via Shop X's URL — file id
    // doesn't belong to Shop X's order, so the order/file cross-check fails.
    const res = await GET(fileReq(shopXSlug, fileBId, orderAToken), {
      params: Promise.resolve({ slug: shopXSlug, fileId: fileBId }),
    });
    expect(res.status).toBe(404);
  });

  it('No token at all is rejected', async () => {
    const { GET } = await import('@/app/api/v1/s/[slug]/files/[fileId]/route');
    const url = `http://localhost:3000/api/v1/s/${shopXSlug}/files/${fileAId}`;
    const res = await GET(new NextRequest(url, { headers: { 'x-forwarded-for': '203.0.113.99' } }), {
      params: Promise.resolve({ slug: shopXSlug, fileId: fileAId }),
    });
    expect(res.status).toBe(404);
  });

  it('Random token (not a real order) is rejected even for a real file id', async () => {
    const { GET } = await import('@/app/api/v1/s/[slug]/files/[fileId]/route');
    const fakeToken = 'e'.repeat(64);
    const res = await GET(fileReq(shopXSlug, fileAId, fakeToken), {
      params: Promise.resolve({ slug: shopXSlug, fileId: fileAId }),
    });
    expect(res.status).toBe(404);
  });
});

describe('IDOR — cross-tenant order tracking via /api/v1/o/[token]', () => {
  it('Shop X customer tracks their own order (sanity)', async () => {
    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/v1/o/${orderAToken}`, {
        headers: { 'x-forwarded-for': '203.0.113.101' },
      }),
      { params: Promise.resolve({ token: orderAToken }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.order.id).toBe(orderAId);
  });

  it('Shop Y customer CANNOT see Shop X files via tracking — only their own order payload', async () => {
    // Tracking with Order B's token returns Order B's files only — never
    // Order A's, even though both shops share the same global token registry.
    const { GET } = await import('@/app/api/v1/o/[token]/route');
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/v1/o/${orderBToken}`, {
        headers: { 'x-forwarded-for': '203.0.113.102' },
      }),
      { params: Promise.resolve({ token: orderBToken }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const fileIds = (json.data.files as Array<{ id: string }>).map((f) => f.id);
    expect(fileIds).toContain(fileBId);
    expect(fileIds).not.toContain(fileAId);
  });
});

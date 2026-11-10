import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * P1-15 — Integration tests for server-authoritative page selection + pricing.
 *
 * These tests exercise the REAL PATCH `/api/v1/orders/:id/files/:fileId` and
 * POST `/api/v1/orders/:id/checkout` route handlers end-to-end against an
 * in-memory database. They prove that:
 *
 *   1. A `pageRange="1-5"` on a 200-page file is priced for 5 pages, not 200.
 *   2. A `pageRange=null` (or omitted) falls back to all 200 pages —
 *      preserving backward compatibility with pre-page-selection orders.
 *   3. `copies × selectedPages` is the correct billable quantity.
 *   4. The checkout amount is the SERVER-CALCULATED `order.totalAmountPaise`,
 *      NEVER a client-supplied total (the body isn't even read).
 *
 * Pattern: in-memory container + JWT auth + real NextRequest (copied from
 * `src/lib/api/payment-route-tests.test.ts`).
 */

// ── vi.mock is hoisted to the top of the file by vitest ─────────────
// Replaces @/lib/db so the checkout route's `db.paymentAttempt.create`
// call (the FIND-PAY-001-ORDER pre-provider persistence) doesn't require
// a real Prisma client. The repositories use the in-memory container db;
// this mock only affects the dynamic-import DB fallback path.
vi.mock('@/lib/db', () => ({
  db: {
    paymentAttempt: {
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'test-attempt-id' }),
    },
    paymentEvent: {
      create: vi.fn().mockResolvedValue({ id: 'test-event-id' }),
      update: vi.fn().mockResolvedValue({ id: 'test-event-id' }),
    },
  },
}));

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

// ── Per-test state (reset in beforeEach) ──
let container: Container;
let shopId: string;
let orderId: string;
let customerToken: string;
let fileId: string;

// The 200-page file used in every test. The default pricing config gives
// ₹2/BW-A4 page = 200 paise/page, bulk 5% off at >=100 pages, min order ₹5.
const FILE_PAGE_COUNT = 200;

beforeEach(async () => {
  // ── Fresh in-memory container ──
  const db = new InMemoryDatabaseAdapter();
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

  // ── Shop + owner ──
  const user = await repos.users.create({
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
    slug: `test-${shopId.slice(0, 8)}`,
    ownerUserId: user.id,
    upiId: 'test@upi',
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
  await repos.users.update(user.id, { shopId });

  // ── Order in awaiting_payment, with one 200-page file ──
  customerToken = 'TOK' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const order = await repos.orders.create({ shopId, customerToken });
  orderId = order.id;

  const file = await repos.files.create({
    orderId,
    originalFilename: 'big-doc.pdf',
    storageKey: `test/${orderId}/big-doc.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pageCount: FILE_PAGE_COUNT,
  });
  fileId = file.id;
  // Files start at pricePaise=0; the PATCH route will compute the real price.
});

// ── Helper: PATCH a file's settings ──────────────────────────────────
async function patchFile(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/v1/orders/[id]/files/[fileId]/route');
  const req = new NextRequest(
    `http://localhost:3000/api/v1/orders/${orderId}/files/${fileId}`,
    {
      method: 'PATCH',
      headers: {
        'X-Order-Token': customerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  return PATCH(req, { params: Promise.resolve({ id: orderId, fileId }) });
}

// ── Helper: POST a checkout ──────────────────────────────────────────
async function checkout(body?: unknown) {
  const { POST } = await import('@/app/api/v1/orders/[id]/checkout/route');
  const req = new NextRequest(
    `http://localhost:3000/api/v1/orders/${orderId}/checkout`,
    {
      method: 'POST',
      headers: {
        'X-Order-Token': customerToken,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
  return POST(req, { params: Promise.resolve({ id: orderId }) });
}

// ════════════════════════════════════════════════════════════════════
// 1. PATCH with a pageRange subset → priced for the selected pages
// ════════════════════════════════════════════════════════════════════

describe('P1-15: PATCH /files/[fileId] uses billablePages, not file.pageCount', () => {
  it('1. pageRange="1-5" on a 200-page file → priced for 5 pages (₹10 = 1000 paise)', async () => {
    // Default config: bw_a4_per_page = 200 paise. 5 pages × 1 copy = 1000 paise.
    // (5 pages is well under the 100-page bulk threshold — no bulk discount.)
    const res = await patchFile({
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      pageRange: '1-5',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.file.pricePaise).toBe(1000); // 5 × 200
    expect(json.data.orderTotalPaise).toBe(1000);
    // Line item quantity must reflect selected pages (5), NOT 200.
    expect(json.data.lineItems[0].quantity).toBe(5);

    // Verify the price persisted on the file row in the DB.
    const fresh = await repos.files.findByIdAndOrder(fileId, orderId);
    expect(fresh?.pricePaise).toBe(1000);
    expect(fresh?.pageRange).toBe('1-5');

    // And the order total was updated to match.
    const freshOrder = await repos.orders.findById(orderId);
    expect(freshOrder?.totalAmountPaise).toBe(1000);
  });

  it('2. pageRange=null (explicit) → priced for ALL 200 pages (bulk-discount applied)', async () => {
    // 200 pages × 200 paise = 40000 paise gross.
    // 200 >= 100 (bulk threshold) → 5% bulk discount → 40000 - 2000 = 38000.
    // No duplex → no duplex line.
    const res = await patchFile({
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      pageRange: null,
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.file.pricePaise).toBe(38000);
    expect(json.data.orderTotalPaise).toBe(38000);
    expect(json.data.lineItems[0].quantity).toBe(200); // all pages
    // Bulk line item appears.
    expect(json.data.lineItems.some((i: any) => i.label.includes('Bulk'))).toBe(true);

    const fresh = await repos.files.findByIdAndOrder(fileId, orderId);
    expect(fresh?.pricePaise).toBe(38000);
    expect(fresh?.pageRange).toBeNull();
  });

  it('3. copies=3 + pageRange="1-5" → billed for 15 pages (5 selected × 3 copies)', async () => {
    // 5 pages × 3 copies = 15 total pages × 200 paise = 3000 paise.
    // 15 < 100 → no bulk.
    const res = await patchFile({
      copies: 3,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      pageRange: '1-5',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.file.pricePaise).toBe(3000); // 15 × 200
    expect(json.data.lineItems[0].quantity).toBe(15); // 5 selected × 3 copies

    const fresh = await repos.files.findByIdAndOrder(fileId, orderId);
    expect(fresh?.pricePaise).toBe(3000);
    expect(fresh?.copies).toBe(3);
  });

  it('4. price is recomputed when pageRange changes (200-page → 5-page → 200-page)', async () => {
    // First: 5-page selection.
    await patchFile({ pageRange: '1-5', copies: 1, colorMode: 'bw', paperSize: 'a4', duplex: false });
    let fresh = await repos.files.findByIdAndOrder(fileId, orderId);
    expect(fresh?.pricePaise).toBe(1000);

    // Now expand back to all 200 pages.
    await patchFile({ pageRange: null, copies: 1, colorMode: 'bw', paperSize: 'a4', duplex: false });
    fresh = await repos.files.findByIdAndOrder(fileId, orderId);
    expect(fresh?.pricePaise).toBe(38000); // 200-page bulk-discounted total

    // And the order total must track the file price.
    const freshOrder = await repos.orders.findById(orderId);
    expect(freshOrder?.totalAmountPaise).toBe(38000);
  });

  it('5. rejects an out-of-range pageRange with a clear 400 error', async () => {
    // 200-page file, customer asks for pages "1-250" — beyond the document.
    const res = await patchFile({
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      pageRange: '1-250',
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toContain('200-page');
    expect(json.error.message).toContain('1 and 200');

    // The file's price MUST remain unchanged (no partial mutation).
    const fresh = await repos.files.findByIdAndOrder(fileId, orderId);
    expect(fresh?.pricePaise).toBe(0); // never repriced — original price preserved
  });

  it('6. rejects a reversed range "5-3" with a 400', async () => {
    const res = await patchFile({
      copies: 1,
      colorMode: 'bw',
      paperSize: 'a4',
      duplex: false,
      pageRange: '5-3',
    });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Checkout amount integrity — server-calculated total, no client input
// ════════════════════════════════════════════════════════════════════

describe('P1-15: POST /checkout uses server-calculated total (no client tampering)', () => {
  it('7. checkout amount matches the server-side persisted total (5-page selection)', async () => {
    // Price the file for 5 pages → 1000 paise persisted on the order.
    await patchFile({
      copies: 1, colorMode: 'bw', paperSize: 'a4', duplex: false, pageRange: '1-5',
    });

    const res = await checkout();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // The checkout amount MUST match the server-side persisted order total.
    expect(json.data.amountPaise).toBe(1000);

    const freshOrder = await repos.orders.findById(orderId);
    expect(freshOrder?.totalAmountPaise).toBe(1000);
    expect(json.data.amountPaise).toBe(freshOrder?.totalAmountPaise);
  });

  it('8. price tampering: client sends totalAmountPaise=1 → checkout still uses server total', async () => {
    // Price the file for 5 pages → server-side total = 1000 paise.
    await patchFile({
      copies: 1, colorMode: 'bw', paperSize: 'a4', duplex: false, pageRange: '1-5',
    });

    // A malicious client sends a forged total in the checkout body.
    // The route handler MUST ignore it (it doesn't even parse the body).
    const res = await checkout({ totalAmountPaise: 1, amountPaise: 1 });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // The amount returned matches the server-side total, NOT the client's 1.
    expect(json.data.amountPaise).toBe(1000);
    expect(json.data.amountPaise).not.toBe(1);
  });

  it('9. checkout amount reflects the full 200-page selection (bulk-discounted)', async () => {
    // All 200 pages → 38000 paise (after 5% bulk discount).
    await patchFile({
      copies: 1, colorMode: 'bw', paperSize: 'a4', duplex: false, pageRange: null,
    });

    const res = await checkout();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.amountPaise).toBe(38000);
  });

  it('10. checkout amount reflects copies × selected pages (15 pages)', async () => {
    // 5 selected pages × 3 copies = 15 pages × 200 paise = 3000 paise.
    await patchFile({
      copies: 3, colorMode: 'bw', paperSize: 'a4', duplex: false, pageRange: '1-5',
    });

    const res = await checkout();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.amountPaise).toBe(3000);
  });
});

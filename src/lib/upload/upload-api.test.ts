import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REAL upload HTTP route-handler tests — invoke the ACTUAL exported route
 * handlers for the consumer upload flow with real NextRequest objects and a
 * real customer-token-gated order.
 *
 * Pattern is copied from `src/lib/api/payment-route-tests.test.ts`:
 *  - vi.mock('@/lib/db') at the top of the file (hoisted) using the shared
 *    `getMockDb()` factory from `src/lib/payments/test-prisma-mock.ts`. This
 *    lets the `@/lib/db` import inside `container.ts` resolve without a real
 *    Prisma client (the production container reads `DATABASE_PROVIDER` and
 *    builds a PrismaDatabaseAdapter — we override the container with an
 *    InMemoryDatabaseAdapter via `setContainerForTesting`, but the `db`
 *    module's side-effect import at the top of `container.ts` still runs, so
 *    the mock is required to keep module loading cheap + side-effect free).
 *  - InMemoryDatabaseAdapter + JwtAuthAdapter + InMemoryStorageAdapter via
 *    `setContainerForTesting()` for the actual route-handler work.
 *  - shops + orders created via `repos.shops.create()` + `repos.orders.create()`.
 *  - route handlers imported as `const { POST } = await import('...')`.
 *  - customer-token authentication via the `X-Order-Token` header (the
 *    `withOrderAccess` guard constant-time-compares it against
 *    `order.customerToken`).
 *
 * The InMemoryStorageAdapter exposes `put(key, bytes, ct)` so tests can
 * simulate a completed presigned-URL upload before calling the confirm
 * endpoint. The adapter's `head(key)` + `getBytes(key)` are what the confirm
 * route uses to verify the bytes landed + parse the PDF page count.
 */

// ── vi.mock is hoisted to the top of the file by vitest ─────────────
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
import { createDefaultPricingConfig, MAX_UPLOAD_SIZE_BYTES, type Shop } from '@platform/core/domain';
import { resetMockDb } from '@/lib/payments/test-prisma-mock';
import { storageKey } from '@platform/utils';

// ── Per-test state (reset in beforeEach) ──
let container: Container;
let shopId: string;
let orderId: string;
let customerToken: string;

beforeEach(async () => {
  // Phase 5.3: reset the shared Prisma mock's internal Maps + vi.fn call history.
  resetMockDb();

  // ── Fresh in-memory container for every test ──
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

  // ── Shop + owner (the order is consumer-facing, but the shop must exist
  //    so the storage namespace `shops/<shopId>/orders/<orderId>/<fileId>`
  //    resolves correctly in the confirm tests) ──
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

  // ── Order awaiting payment — the only status that accepts file uploads ──
  customerToken = 'TOK' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const order = await repos.orders.create({ shopId, customerToken });
  orderId = order.id;
});

// ── Helpers ────────────────────────────────────────────────────────

/** Build a NextRequest that proves ownership of the order via X-Order-Token. */
function orderAuthedReq(
  method: string,
  path: string,
  opts?: { body?: unknown; headers?: Record<string, string> },
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      'X-Order-Token': customerToken,
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts?.headers,
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
}

/** Build a minimal valid single-page PDF byte stream. */
function minimalPdfBytes(): Uint8Array {
  // A 1-page PDF — enough for pdf-lib to report pageCount=1.
  return new TextEncoder().encode(
    '%PDF-1.4\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
      'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
      'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n206\n%%EOF',
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. POST /api/v1/orders/[id]/files/upload-url — presigned URL minting
// ════════════════════════════════════════════════════════════════════

describe('POST /api/v1/orders/:id/files/upload-url — customer-token-gated', () => {
  it('1. returns 200 + a presigned PUT URL + storageKey for a valid PDF', async () => {
    const { POST } = await import('@/app/api/v1/orders/[id]/files/upload-url/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files/upload-url`,
      {
        body: {
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.fileId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(json.data.storageKey).toBe(
      `shops/${shopId}/orders/${orderId}/${json.data.fileId}`,
    );
    // InMemoryStorageAdapter mints a relative /api/v1/storage/put?... URL.
    expect(json.data.uploadUrl).toMatch(/^\/api\/v1\/storage\/put\?/);
    expect(json.data.expiresInSeconds).toBe(300);
  });

  it('2. returns 400 for an unsupported file type (.exe / application/octet-stream)', async () => {
    const { POST } = await import('@/app/api/v1/orders/[id]/files/upload-url/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files/upload-url`,
      {
        body: {
          filename: 'malware.exe',
          mimeType: 'application/octet-stream',
          size: 1024,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    // The route throws ValidationError when the MIME is not in the allowlist.
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/unsupported file type/i);
  });

  it('3. returns 400 when the file size exceeds MAX_UPLOAD_SIZE_BYTES (25 MB)', async () => {
    const { POST } = await import('@/app/api/v1/orders/[id]/files/upload-url/route');
    const tooBig = MAX_UPLOAD_SIZE_BYTES + 1;
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files/upload-url`,
      {
        body: {
          filename: 'huge.pdf',
          mimeType: 'application/pdf',
          size: tooBig,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/too large/i);
  });

  it('returns 403 when no X-Order-Token is provided (SEC-001 IDOR guard)', async () => {
    const { POST } = await import('@/app/api/v1/orders/[id]/files/upload-url/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/files/upload-url`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
    // The error must NOT reveal whether the order exists.
    expect(json.error.message).not.toContain(orderId);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. POST /api/v1/orders/[id]/files — confirm upload + parse page count
// ════════════════════════════════════════════════════════════════════

describe('POST /api/v1/orders/:id/files — confirm upload + page count', () => {
  it('4. confirms a file with a valid in-namespace storageKey + parses page count', async () => {
    // Simulate the presigned-URL PUT landing bytes in storage.
    const fileId = crypto.randomUUID();
    const key = storageKey(shopId, orderId, fileId);
    const bytes = minimalPdfBytes();
    await (container.storage as InMemoryStorageAdapter).put(key, bytes, 'application/pdf');

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files`,
      {
        body: {
          fileId,
          storageKey: key,
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          size: bytes.length,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.fileId).toMatch(/^[0-9a-f-]{36}$/i);
    // pdf-lib parses the minimal 1-page PDF → pageCount = 1.
    expect(json.data.pageCount).toBe(1);
    expect(json.data.needsReview).toBe(false);
    expect(json.data.status).toBe('pending');

    // The file row should be persisted with the parsed page count.
    const files = await repos.files.findByOrder(orderId);
    expect(files).toHaveLength(1);
    expect(files[0]!.pageCount).toBe(1);
    expect(files[0]!.originalFilename).toBe('invoice.pdf');
    expect(files[0]!.sizeBytes).toBe(bytes.length);

    // An audit log entry must be written (defence-in-depth — observability).
    const audits = await repos.audit.findByEntity(shopId, files[0]!.id);
    expect(audits.some((a) => a.action === 'file.upload')).toBe(true);
  });

  it('5. returns 400 when the storageKey is in the WRONG namespace (cross-order attack)', async () => {
    // A customer with a valid token for order X tries to confirm a storageKey
    // minted for order Y (same shop). The prefix guard rejects this —
    // otherwise the file record would be created under order X but point at
    // bytes in order Y's namespace.
    const otherOrderId = crypto.randomUUID();
    const otherFileId = crypto.randomUUID();
    const wrongKey = `shops/${shopId}/orders/${otherOrderId}/${otherFileId}`;
    // Bytes DO exist at the wrong key — the prefix guard fires BEFORE the
    // HEAD check, so this is a clean 400, not a "not found" error.
    await (container.storage as InMemoryStorageAdapter).put(
      wrongKey,
      minimalPdfBytes(),
      'application/pdf',
    );

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files`,
      {
        body: {
          fileId: otherFileId,
          storageKey: wrongKey,
          filename: 'cross-order.pdf',
          mimeType: 'application/pdf',
          size: minimalPdfBytes().length,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/namespace/i);

    // No file row must have been created under the target order.
    const files = await repos.files.findByOrder(orderId);
    expect(files).toHaveLength(0);
  });

  it('6. returns 400 when the declared size does not match the stored size (size mismatch)', async () => {
    const fileId = crypto.randomUUID();
    const key = storageKey(shopId, orderId, fileId);
    // Store 1024 bytes.
    await (container.storage as InMemoryStorageAdapter).put(
      key,
      new Uint8Array(1024),
      'application/pdf',
    );

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files`,
      {
        body: {
          fileId,
          storageKey: key,
          filename: 'mismatch.pdf',
          mimeType: 'application/pdf',
          size: 2048, // ← declared size != stored size (1024)
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/size mismatch/i);
    expect(json.error.message).toContain('2048');
    expect(json.error.message).toContain('1024');

    // No file row should be persisted for a mismatched confirmation.
    const files = await repos.files.findByOrder(orderId);
    expect(files).toHaveLength(0);
  });

  it('returns 400 when the storageKey points at an object that was never uploaded (HEAD miss)', async () => {
    const fileId = crypto.randomUUID();
    const key = storageKey(shopId, orderId, fileId);
    // Note: NO bytes stored at `key` — the HEAD call inside the confirm
    // handler must return null + the route returns a clear "not found" error.

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files`,
      {
        body: {
          fileId,
          storageKey: key,
          filename: 'ghost.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/not found in storage/i);
  });

  it('marks a file needs_review when page count cannot be parsed (Office doc)', async () => {
    // .docx — the parsePageCount helper returns null for Office formats.
    const fileId = crypto.randomUUID();
    const key = storageKey(shopId, orderId, fileId);
    await (container.storage as InMemoryStorageAdapter).put(
      key,
      new Uint8Array(512),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files`,
      {
        body: {
          fileId,
          storageKey: key,
          filename: 'essay.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 512,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.pageCount).toBeNull();
    expect(json.data.needsReview).toBe(true);
    expect(json.data.status).toBe('needs_review');
  });
});

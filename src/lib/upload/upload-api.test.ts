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
    // ── Phase 6.x confirm endpoint contract (post-document-pricing refactor) ──
    // The page count was confidently extracted from the PDF → 'auto_extracted',
    // never 'placeholder'. A placeholder would block pricing + checkout.
    expect(json.data.pageCountSource).toBe('auto_extracted');
    expect(json.data.pageCountEstimated).toBe(false);
    // A healthy, parseable PDF carries no processing error.
    expect(json.data.processingError).toBeNull();
    // The file is billable immediately → status='pending' (NOT 'needs_review').
    expect(json.data.status).toBe('pending');
    expect(json.data.needsReview).toBe(false);
    // 1 page × 200 paise (bw_a4 default) = 200 paise, below the ₹5 min order →
    // rounded up to 500 paise. Non-zero price proves the file was priced.
    expect(json.data.pricePaise).toBeGreaterThan(0);
    expect(json.data.pricePaise).toBe(500);
    // The order total mirrors the (single) file's price.
    expect(json.data.orderTotalPaise).toBe(json.data.pricePaise);

    // The file row should be persisted with the parsed page count + source + price.
    const files = await repos.files.findByOrder(orderId);
    expect(files).toHaveLength(1);
    expect(files[0]!.pageCount).toBe(1);
    expect(files[0]!.pageCountSource).toBe('auto_extracted');
    expect(files[0]!.status).toBe('pending');
    expect(files[0]!.pricePaise).toBe(json.data.pricePaise);
    expect(files[0]!.processingError).toBeNull();
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

  it('marks a legacy .doc file needs_review with pageCountSource=placeholder (no page count, no price)', async () => {
    // Legacy .doc (application/msword) is a binary Office format the parser
    // cannot read without rendering → parsePageCount returns null. The
    // confirm endpoint must mark the file as 'needs_review' with
    // pageCountSource='placeholder' + pricePaise=0 so the file CANNOT be
    // checked out until a human supplies a page count.
    const docMime = 'application/msword';
    const fileId = crypto.randomUUID();
    const key = storageKey(shopId, orderId, fileId);
    await (container.storage as InMemoryStorageAdapter).put(
      key,
      new Uint8Array(512),
      docMime,
    );

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const req = orderAuthedReq(
      'POST',
      `/api/v1/orders/${orderId}/files`,
      {
        body: {
          fileId,
          storageKey: key,
          filename: 'essay.doc',
          mimeType: docMime,
          size: 512,
        },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // No page count was extracted — null sentinel rather than 0.
    expect(json.data.pageCount).toBeNull();
    // The source is 'placeholder' (NOT 'auto_extracted') — this is the flag
    // the UI / checkout guard keys on to block bill-now.
    expect(json.data.pageCountSource).toBe('placeholder');
    expect(json.data.pageCountEstimated).toBe(true);
    // A placeholder NEVER generates a bill — the price MUST be zero.
    expect(json.data.pricePaise).toBe(0);
    // The order total reflects the unpriced file (₹0 so far).
    expect(json.data.orderTotalPaise).toBe(0);
    // The file is parked in 'needs_review' so the shopkeeper / customer
    // must enter the page count before checkout is allowed.
    expect(json.data.status).toBe('needs_review');
    expect(json.data.needsReview).toBe(true);
    // A human-readable processing error explains WHY the file needs review.
    expect(json.data.processingError).toMatch(/page count/i);
    expect(json.data.processingError).not.toBeNull();

    // The file row persists the placeholder state.
    const files = await repos.files.findByOrder(orderId);
    expect(files).toHaveLength(1);
    expect(files[0]!.pageCount).toBeNull();
    expect(files[0]!.pageCountSource).toBe('placeholder');
    expect(files[0]!.status).toBe('needs_review');
    expect(files[0]!.pricePaise).toBe(0);
    expect(files[0]!.processingError).not.toBeNull();
  });

  it('7. idempotent: confirming the same storageKey twice returns the existing file (no duplicate)', async () => {
    // A browser retry (network timeout after the server already processed
    // the confirmation) must NOT create a duplicate file record or
    // double-count the order total. The second call returns the existing
    // file with `idempotent: true`.
    const fileId = crypto.randomUUID();
    const key = storageKey(shopId, orderId, fileId);
    const bytes = minimalPdfBytes();
    await (container.storage as InMemoryStorageAdapter).put(key, bytes, 'application/pdf');

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const body = {
      fileId,
      storageKey: key,
      filename: 'dup-test.pdf',
      mimeType: 'application/pdf',
      size: bytes.length,
    };

    // First confirmation — normal.
    const req1 = orderAuthedReq('POST', `/api/v1/orders/${orderId}/files`, { body });
    const res1 = await POST(req1, { params: Promise.resolve({ id: orderId }) });
    const json1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(json1.success).toBe(true);
    const firstFileId = json1.data.fileId;
    const firstPrice = json1.data.pricePaise;

    // Second confirmation — same storageKey (retry).
    const req2 = orderAuthedReq('POST', `/api/v1/orders/${orderId}/files`, { body });
    const res2 = await POST(req2, { params: Promise.resolve({ id: orderId }) });
    const json2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(json2.success).toBe(true);
    // Same file ID — not a new record.
    expect(json2.data.fileId).toBe(firstFileId);
    // The idempotent flag tells the client this was a replay.
    expect(json2.data.idempotent).toBe(true);
    // Price is the same — not double-counted.
    expect(json2.data.pricePaise).toBe(firstPrice);

    // Only ONE file in the database — no duplicate.
    const files = await repos.files.findByOrder(orderId);
    expect(files).toHaveLength(1);
    // Order total reflects one file, not two.
    expect(json2.data.orderTotalPaise).toBe(firstPrice);
  });

  it('8. stale-response fix: pricing failure after extraction returns persisted needs_review (not stale pending)', async () => {
    // When page-count extraction succeeds but pricing fails (e.g. the shop
    // has an empty pricing config), the confirm endpoint must update the
    // file to needs_review/placeholder in the DATABASE and return the
    // PERSISTED values — NOT the stale in-memory values (pending/
    // auto_extracted) that existed before the pricing failure.
    //
    // This is the stale-response bug: the response previously returned
    // the original `file` variable which still had status='pending',
    // pageCountSource='auto_extracted', processingError=null — even
    // though the database had been updated to needs_review/placeholder/
    // <error message>.

    // Break the shop's pricing config so pricing fails after extraction.
    await repos.shops.update(shopId, {
      pricingConfig: {} as unknown as ReturnType<typeof createDefaultPricingConfig>,
    });

    const fileId = crypto.randomUUID();
    const key = storageKey(shopId, orderId, fileId);
    const bytes = minimalPdfBytes();
    await (container.storage as InMemoryStorageAdapter).put(key, bytes, 'application/pdf');

    const { POST } = await import('@/app/api/v1/orders/[id]/files/route');
    const req = orderAuthedReq('POST', `/api/v1/orders/${orderId}/files`, {
      body: {
        fileId,
        storageKey: key,
        filename: 'stale-test.pdf',
        mimeType: 'application/pdf',
        size: bytes.length,
      },
    });
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // The page count WAS extracted (pdf-lib parsed the minimal PDF), but
    // pricing failed because the config is empty. The response MUST
    // reflect the PERSISTED state — needs_review/placeholder — not the
    // stale in-memory state (pending/auto_extracted).
    expect(json.data.status).toBe('needs_review');
    expect(json.data.pageCountSource).toBe('placeholder');
    expect(json.data.needsReview).toBe(true);
    expect(json.data.pricePaise).toBe(0);
    expect(json.data.processingError).not.toBeNull();
    // The processing error should mention pricing/config.
    expect(json.data.processingError).toMatch(/pricing|config/i);

    // Verify the DATABASE also has the correct state (not just the response).
    const files = await repos.files.findByOrder(orderId);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe('needs_review');
    expect(files[0]!.pageCountSource).toBe('placeholder');
    expect(files[0]!.pricePaise).toBe(0);
    expect(files[0]!.processingError).not.toBeNull();
  });
});

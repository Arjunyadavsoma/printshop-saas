import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REAL Payment HTTP Route-Handler Tests
 *
 * These tests invoke the ACTUAL exported route handler functions (POST, GET)
 * with real NextRequest objects and real JWT / customer tokens. They exercise
 * the full pipeline: auth guard → repository → webhook service → response.
 *
 * Pattern is copied from `src/lib/api/http-route-tests.test.ts`:
 *   - InMemoryDatabaseAdapter + JwtAuthAdapter via setContainerForTesting()
 *   - shops + users created via repos.users.create() + repos.shops.create()
 *   - real JWTs via auth.issueAccessToken()
 *   - route handlers imported as `const { POST } = await import('...')`
 *   - called with `new NextRequest(url, { method, headers, body })`
 *
 * The `@/lib/db` module is mocked so the `lookupPaymentSession` DB-fallback
 * branch (which dynamically imports `db.paymentAttempt.findUnique`) can be
 * exercised without a real Prisma client. The mock factory is hoisted above
 * all imports by vitest; it cannot reference outer-scope variables, so per-test
 * configuration is done via `vi.mocked(...)` inside the test body.
 */

// ── vi.mock is hoisted to the top of the file by vitest ─────────────
// Replaces the @/lib/db module so `await import('@/lib/db')` inside
// webhook.service.ts → lookupPaymentSession returns a controllable mock.
// The container's in-memory db (InMemoryDatabaseAdapter) is still used by
// the repositories; this mock only affects the dynamic-import fallback path.
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
import {
  lookupPaymentSession,
  rememberPaymentSession,
  processWebhook,
} from '@/lib/payments/webhook.service';
import { db as mockedDb } from '@/lib/db';

// ── Test-fixture credentials for the PhonePe adapter (v1 Standard API) ──
// The webhook verification path uses UPIPay's verifyWebhook, which checks
// sha256(base64Body + saltKey)###saltIndex. These exact values are also
// used by `src/lib/payments/payments.test.ts` — keeping them aligned lets
// us reuse the proven signature-generation helper below.
const SALT_KEY = 'test-salt-key';
const PHONEPE_CREDS = {
  phonepe: {
    saltKey: SALT_KEY,
    saltIndex: '1',
    merchantId: 'TESTMID',
    env: 'sandbox' as const,
  },
};

// ── Per-test state (reset in beforeEach) ──
let auth: JwtAuthAdapter;
let container: Container;
let ownerToken: string;
let shopId: string;
let userId: string;
let orderId: string;
let customerToken: string;
let otherShopId: string;
let otherOrderId: string;
let otherOwnerToken: string;

beforeEach(async () => {
  // Clear the @/lib/db mock's call history so per-test assertions are clean.
  vi.mocked(mockedDb.paymentAttempt.findUnique).mockClear();
  // Default: the PaymentAttempt table "misses" — returns null (no row found).
  vi.mocked(mockedDb.paymentAttempt.findUnique).mockResolvedValue(null as never);

  // ── Fresh in-memory container for every test ──
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  auth = new JwtAuthAdapter(
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

  // ── Shop A (the "owned" shop) ──
  const user = await repos.users.create(
    {
      email: 'owner-a@test.com',
      phone: '5555555555',
      password: 'testpass123',
      role: 'owner',
      shopId: null,
    },
    auth,
  );
  userId = user.id;

  shopId = crypto.randomUUID();
  const shopA: Shop = {
    id: shopId,
    name: 'Shop A',
    slug: `shop-a-${shopId.slice(0, 8)}`,
    ownerUserId: userId,
    upiId: 'shopa@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: PHONEPE_CREDS as unknown as Record<string, unknown>,
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
  await repos.shops.create(shopA);
  await repos.users.update(userId, { shopId });

  const access = await auth.issueAccessToken({ id: userId, shopId, role: 'owner' });
  ownerToken = access.token;

  // ── Order in Shop A — awaiting_payment, with one priced file ──
  customerToken = 'TOK' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const order = await repos.orders.create({ shopId, customerToken });
  orderId = order.id;
  // Total amount: ₹100 = 10000 paise
  const file = await repos.files.create({
    orderId,
    originalFilename: 'doc.pdf',
    storageKey: `test/${orderId}/doc.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pageCount: 1,
  });
  await repos.files.update(file.id, { pricePaise: 10000 });
  await repos.orders.update(orderId, { totalAmountPaise: 10000 });

  // ── Shop B (a different owner) for cross-shop / wrong-shop tests ──
  const userB = await repos.users.create(
    {
      email: 'owner-b@test.com',
      phone: '5555556666',
      password: 'testpass123',
      role: 'owner',
      shopId: null,
    },
    auth,
  );
  otherShopId = crypto.randomUUID();
  const shopB: Shop = {
    ...shopA,
    id: otherShopId,
    name: 'Shop B',
    slug: `shop-b-${otherShopId.slice(0, 8)}`,
    ownerUserId: userB.id,
    upiId: 'shopb@okaxis',
    paymentCredentials: PHONEPE_CREDS as unknown as Record<string, unknown>,
  };
  await repos.shops.create(shopB);
  await repos.users.update(userB.id, { shopId: otherShopId });

  const otherOrder = await repos.orders.create({
    shopId: otherShopId,
    customerToken: 'TOK' + Math.random().toString(36).slice(2, 8).toUpperCase(),
  });
  otherOrderId = otherOrder.id;
  const otherFile = await repos.files.create({
    orderId: otherOrderId,
    originalFilename: 'doc-b.pdf',
    storageKey: `test/${otherOrderId}/doc-b.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pageCount: 1,
  });
  await repos.files.update(otherFile.id, { pricePaise: 5000 });
  await repos.orders.update(otherOrderId, { totalAmountPaise: 5000 });

  const bAccess = await auth.issueAccessToken({
    id: userB.id,
    shopId: otherShopId,
    role: 'owner',
  });
  otherOwnerToken = bAccess.token;
});

// ── Helpers ────────────────────────────────────────────────────────

/** SHA-256 hex digest of a string (used to build real PhonePe X-VERIFY signatures). */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a real PhonePe v1 callback payload + X-VERIFY signature. */
async function buildPhonePePayload(opts: {
  merchantOrderId: string;
  txnId: string;
  amountPaise: number;
  state?: 'COMPLETED' | 'FAILED';
  code?: string;
}): Promise<{ rawBody: string; xVerify: string }> {
  const state = opts.state ?? 'COMPLETED';
  const code = opts.code ?? (state === 'COMPLETED' ? 'PAYMENT_SUCCESS' : 'PAYMENT_ERROR');
  const payload = {
    code,
    data: {
      merchantId: 'TESTMID',
      merchantTransactionId: opts.merchantOrderId,
      transactionId: opts.txnId,
      amount: opts.amountPaise,
      state,
      paymentInstrument: { type: 'UPI', utr: opts.txnId },
    },
  };
  const base64Body = btoa(JSON.stringify(payload));
  const mac = await sha256Hex(base64Body + SALT_KEY);
  return { rawBody: base64Body, xVerify: `${mac}###1` };
}

// ════════════════════════════════════════════════════════════════════
// 1. Checkout — POST /api/v1/orders/[id]/checkout
// ════════════════════════════════════════════════════════════════════

describe('POST /api/v1/orders/:id/checkout — customer-token-gated', () => {
  it('1. returns 200 with a payment intent when the order token is valid', async () => {
    const { POST } = await import('@/app/api/v1/orders/[id]/checkout/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/checkout`,
      {
        method: 'POST',
        headers: { 'X-Order-Token': customerToken },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // The UPI deep-link adapter mints an intent with these fields.
    expect(json.data.orderId).toBe(orderId);
    expect(json.data.merchantOrderId).toBeDefined();
    expect(json.data.amountPaise).toBe(10000);
    expect(json.data.provider).toBe('googlepay');
    expect(json.data.upiUri).toMatch(/^upi:\/\/pay\?/);
    expect(json.data.qrPayload).toMatch(/^upi:\/\/pay\?/);
  });

  it('2. returns 403 when no X-Order-Token header is provided', async () => {
    const { POST } = await import('@/app/api/v1/orders/[id]/checkout/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/checkout`,
      { method: 'POST' },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
    // The error message must NOT reveal whether the order exists.
    expect(json.error.message).not.toContain(orderId);
  });

  it('3. returns 403 when the X-Order-Token does not constant-time-match', async () => {
    const { POST } = await import('@/app/api/v1/orders/[id]/checkout/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/orders/${orderId}/checkout`,
      {
        method: 'POST',
        headers: { 'X-Order-Token': 'WRONG-TOKEN-VALUE' },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Manual payment verification — POST /api/v1/shops/me/orders/[id]/verify-payment
// ════════════════════════════════════════════════════════════════════

describe('POST /api/v1/shops/me/orders/:id/verify-payment — owner JWT', () => {
  it('4. returns 200 and transitions the order to paid (action=verify)', async () => {
    const { POST } = await import(
      '@/app/api/v1/shops/me/orders/[id]/verify-payment/route'
    );
    const req = new NextRequest(
      `http://localhost:3000/api/v1/shops/me/orders/${orderId}/verify-payment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'verify', txnReference: 'UTR-TEST-123' }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('paid');
    // Deterministic txnId — race-safe replay guard (ARCH-001 fix).
    expect(json.data.paymentTxnId).toBe(`manual-${orderId}`);
    expect(json.data.paymentUtr).toBe('UTR-TEST-123');
    expect(json.data.paidAt).toBeTruthy();

    // Confirm the order row was actually flipped in the DB.
    const fresh = await repos.orders.findById(orderId);
    expect(fresh?.status).toBe('paid');
    expect(fresh?.paymentTxnId).toBe(`manual-${orderId}`);
  });

  it('5. returns 401 without an Authorization header', async () => {
    const { POST } = await import(
      '@/app/api/v1/shops/me/orders/[id]/verify-payment/route'
    );
    const req = new NextRequest(
      `http://localhost:3000/api/v1/shops/me/orders/${orderId}/verify-payment`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'verify' }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: orderId }) });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('6. returns 404 when the order belongs to a different shop (cross-tenant guard)', async () => {
    const { POST } = await import(
      '@/app/api/v1/shops/me/orders/[id]/verify-payment/route'
    );
    // Shop A owner tries to verify Shop B's order → findByIdAndShop returns null.
    const req = new NextRequest(
      `http://localhost:3000/api/v1/shops/me/orders/${otherOrderId}/verify-payment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'verify' }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: otherOrderId }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');

    // Shop B's order must remain untouched (no cross-tenant mutation).
    const fresh = await repos.orders.findById(otherOrderId);
    expect(fresh?.status).toBe('awaiting_payment');
    expect(fresh?.paymentTxnId).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Webhook routes — POST phonepe/webhook, POST paytm/callback
// ════════════════════════════════════════════════════════════════════

describe('POST /api/v1/payments/phonepe/webhook — empty / malformed payloads', () => {
  it('7. with an empty body returns 400 (no merchantOrderId extractable)', async () => {
    const { POST } = await import('@/app/api/v1/payments/phonepe/webhook/route');
    const req = new NextRequest(
      'http://localhost:3000/api/v1/payments/phonepe/webhook',
      { method: 'POST' },
    );
    const res = await POST(req);
    const json = await res.json();

    // Empty body → extractReference returns null → processWebhook returns 400.
    expect(res.status).toBe(400);
    expect(json.success).toBe(false); // 400 is not < 400
    expect(json.data.summary).toMatch(/no merchantOrderId/i);
    expect(json.data.applied).toBe(false);
  });
});

describe('POST /api/v1/payments/paytm/callback — empty / malformed payloads', () => {
  it('8. with an empty body returns 400 (no ORDERID in form body)', async () => {
    const { POST } = await import('@/app/api/v1/payments/paytm/callback/route');
    const req = new NextRequest(
      'http://localhost:3000/api/v1/payments/paytm/callback',
      { method: 'POST' },
    );
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.data.summary).toMatch(/no merchantOrderId/i);
    expect(json.data.applied).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. UPI verify — GET /api/v1/payments/upi/verify/[orderId]
// ════════════════════════════════════════════════════════════════════

describe('GET /api/v1/payments/upi/verify/:orderId — public status poll', () => {
  it('9. returns 200 with paid=false for an awaiting_payment order', async () => {
    const { GET } = await import('@/app/api/v1/payments/upi/verify/[orderId]/route');
    const req = new NextRequest(
      `http://localhost:3000/api/v1/payments/upi/verify/${orderId}`,
      { method: 'GET' },
    );
    const res = await GET(req, { params: Promise.resolve({ orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.paid).toBe(false);
    expect(json.data.status).toBe('awaiting_payment');
    expect(json.data.amountPaise).toBeNull(); // amount only surfaced once paid
    expect(json.data.txnId).toBeNull();
  });

  it('13. returns 404 NOT_FOUND for a nonexistent orderId (no existence leak via 200)', async () => {
    const { GET } = await import('@/app/api/v1/payments/upi/verify/[orderId]/route');
    const nonexistentId = 'order-that-does-not-exist-' + Date.now();
    const req = new NextRequest(
      `http://localhost:3000/api/v1/payments/upi/verify/${nonexistentId}`,
      { method: 'GET' },
    );
    const res = await GET(req, { params: Promise.resolve({ orderId: nonexistentId }) });
    const json = await res.json();

    // The route handler throws NotFoundError when the order isn't found.
    // Returning 404 (NOT_FOUND) is the correct behaviour — silently returning
    // 200 with paid=false would leak order existence to unauthenticated
    // pollers (SEC-001: order UUIDs are NOT credentials).
    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Payment idempotency — lookupPaymentSession / rememberPaymentSession
//    (functions in src/lib/payments/webhook.service.ts)
// ════════════════════════════════════════════════════════════════════

describe('Payment session idempotency helpers', () => {
  it('10. lookupPaymentSession returns null for an unknown merchantOrderId', async () => {
    const unknown = 'unknown-moid-' + Date.now();
    // Cache miss (no rememberPaymentSession was called) → DB fallback →
    // the mocked paymentAttempt.findUnique returns null by default → null.
    const session = await lookupPaymentSession(unknown);
    expect(session).toBeNull();
    // The DB fallback path was actually consulted (defence-in-depth).
    expect(mockedDb.paymentAttempt.findUnique).toHaveBeenCalledTimes(1);
    expect(mockedDb.paymentAttempt.findUnique).toHaveBeenCalledWith({
      where: { merchantOrderId: unknown },
    });
  });

  it('11. rememberPaymentSession + lookupPaymentSession round-trip via cache', async () => {
    const moid = 'moid-roundtrip-' + Date.now();
    const stored = {
      orderId,
      shopId,
      amountPaise: 10000,
      provider: 'phonepe' as const,
    };
    await rememberPaymentSession(moid, stored);

    const session = await lookupPaymentSession(moid);
    expect(session).not.toBeNull();
    expect(session?.orderId).toBe(orderId);
    expect(session?.shopId).toBe(shopId);
    expect(session?.amountPaise).toBe(10000);
    expect(session?.provider).toBe('phonepe');

    // Cache hit → the DB fallback MUST NOT be consulted (fast path).
    expect(mockedDb.paymentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it('12. lookupPaymentSession falls back to the PaymentAttempt DB row when the cache misses', async () => {
    const moid = 'moid-db-fallback-' + Date.now();
    // Configure the mocked PaymentAttempt row for this merchantOrderId.
    vi.mocked(mockedDb.paymentAttempt.findUnique).mockResolvedValue({
      orderId,
      shopId,
      amountPaise: 10000,
      provider: 'phonepe',
      merchantOrderId: moid,
    } as never);

    // Make sure the cache is empty (defensive — fresh container, but be explicit).
    await container.cache.del(`pay:moid:${moid}`);

    const session = await lookupPaymentSession(moid);
    expect(session).not.toBeNull();
    expect(session?.orderId).toBe(orderId);
    expect(session?.shopId).toBe(shopId);
    expect(session?.amountPaise).toBe(10000);
    expect(session?.provider).toBe('phonepe');
    expect(session?.merchantOrderId).toBe(moid);

    // The DB was consulted (cache miss path).
    expect(mockedDb.paymentAttempt.findUnique).toHaveBeenCalledWith({
      where: { merchantOrderId: moid },
    });

    // The cache should be re-populated for future lookups (warm-after-miss).
    const cached = await container.cache.get(`pay:moid:${moid}`);
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached as string).orderId).toBe(orderId);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. processWebhook — amount validation + idempotency cache (spec §6.6 / §6.5)
// ════════════════════════════════════════════════════════════════════

describe('processWebhook — amount validation + idempotency (real X-VERIFY)', () => {
  it('14. rejects a webhook whose amount does not match the order total (₹9999 vs ₹10000)', async () => {
    // The order is in awaiting_payment with totalAmountPaise = 10000.
    // We sign a valid PhonePe payload with amount = 9999 (underpayment attack).
    await rememberPaymentSession(orderId, {
      orderId,
      shopId,
      amountPaise: 10000,
      provider: 'phonepe',
    });

    const txnId = 'TXN-MISMATCH-' + Date.now();
    const { rawBody, xVerify } = await buildPhonePePayload({
      merchantOrderId: orderId,
      txnId,
      amountPaise: 9999, // ← mismatched (order total is 10000)
    });

    const result = await processWebhook({
      provider: 'phonepe',
      rawBody,
      headers: { 'x-verify': xVerify },
      path: '/api/v1/payments/phonepe/webhook',
      ip: null,
    });

    // Signature is valid → verification passes → amount check fires.
    expect(result.statusCode).toBe(400);
    expect(result.applied).toBe(false);
    expect(result.summary).toMatch(/amount mismatch/i);
    expect(result.summary).toContain('10000'); // expected
    expect(result.summary).toContain('9999'); // got
    expect(result.orderId).toBe(orderId);

    // The order MUST remain in awaiting_payment — no paid flip on bad amount.
    const fresh = await repos.orders.findById(orderId);
    expect(fresh?.status).toBe('awaiting_payment');
    expect(fresh?.paymentTxnId).toBeNull();
  });

  it('15. idempotency cache prevents duplicate processing of an already-applied txnId', async () => {
    await rememberPaymentSession(orderId, {
      orderId,
      shopId,
      amountPaise: 10000,
      provider: 'phonepe',
    });

    // Pre-populate the idempotency cache — simulating that this txnId was
    // already processed (e.g. a redelivery of the same callback).
    const txnId = 'TXN-IDEMP-' + Date.now();
    const processedKey = `pay:done:phonepe:${txnId}`;
    await container.cache.set(processedKey, orderId, 86400);

    const { rawBody, xVerify } = await buildPhonePePayload({
      merchantOrderId: orderId,
      txnId,
      amountPaise: 10000, // amount is correct — the only reason to skip is idempotency
    });

    const result = await processWebhook({
      provider: 'phonepe',
      rawBody,
      headers: { 'x-verify': xVerify },
      path: '/api/v1/payments/phonepe/webhook',
      ip: null,
    });

    // The webhook is acknowledged (PhonePe expects 2xx) but applied=false.
    expect(result.statusCode).toBe(200);
    expect(result.applied).toBe(false);
    expect(result.summary).toMatch(/idempotent/i);
    expect(result.summary).toMatch(/already processed/i);
    expect(result.orderId).toBe(orderId);

    // The order MUST remain in awaiting_payment — the cache short-circuits
    // BEFORE the transitionStatus call, so no audit log, no print enqueue.
    const fresh = await repos.orders.findById(orderId);
    expect(fresh?.status).toBe('awaiting_payment');
    expect(fresh?.paymentTxnId).toBeNull();

    // No "paid" audit event was written (would only fire on a real transition).
    const paidAudits = await repos.audit.findByAction('webhook.phonepe.paid');
    expect(paidAudits.length).toBe(0);
  });
});

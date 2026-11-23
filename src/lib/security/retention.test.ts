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
import { scheduleForcedCleanupForFile } from '@/lib/services/delivery-coordinator';
import { expireOldSessions, createSession } from '@/lib/pipeline/upload-sessions';

/**
 * P9-Security §7 — Retention job verification.
 *
 * The retention story has three independent sweeps:
 *
 *   (a) File deletion per shop policy — files are deleted from cloud
 *       storage 24h after the order is collected. Implemented via
 *       FileCleanupTask records with `cleanupType: 'after_collect'` and
 *       `scheduledAt = collectedAt + 24h`. The /api/v1/cron/cleanup
 *       endpoint processes them when `scheduledAt <= now`.
 *
 *   (b) Partial upload deletion — abandoned resumable upload sessions
 *       (the customer closed the tab mid-upload) are swept after 1h
 *       with no chunk activity. Implemented via /api/v1/cron/cleanup-uploads
 *       which calls `expireOldSessions`.
 *
 *   (c) Sensitive-document file deletion — files the customer marked as
 *       sensitive (Aadhaar/PAN/ID) are deleted RIGHT AFTER printing, not
 *       after the usual 24h grace. Implemented via `forced` cleanup tasks
 *       with `scheduledAt = now` created when a sensitive file's last
 *       print job completes. The cron processes them on the next tick
 *       (typically within 5 minutes).
 *
 * This test verifies the cron endpoint handles all three cases.
 */

let container: Container;
let shopId: string;
let shopSlug: string;
const CRON_SECRET = 'test-cron-secret';

beforeEach(async () => {
  process.env.CRON_SECRET = CRON_SECRET;

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

  shopSlug = 'shop-' + crypto.randomUUID().slice(0, 8);
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId,
    name: 'Retention Test Shop',
    slug: shopSlug,
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
  await db.update('shop', { id: shopId }, {
    isOpen: true,
    acceptingOrders: true,
    paymentMode: 'UPI_THEN_PRINT',
  } as never);
});

function cronReq(method: 'GET' | 'POST', path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

// ── (a) File deletion per shop policy (24h after pickup) ──

describe('Retention — /api/v1/cron/cleanup processes after_collect tasks', () => {
  it('deletes a file whose scheduledAt has passed (after_collect)', async () => {
    // Create a file with a stored blob.
    const order = await repos.orders.createWithUniqueToken(
      shopId,
      {
        customerPhone: null,
        notes: null,
        regenerateCustomerToken: () =>
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      },
      (c) => String(100 + c),
    );
    const file = await repos.files.create({
      orderId: order.id,
      originalFilename: 'doc.pdf',
      storageKey: `shops/${shopId}/orders/${order.id}/orig/${crypto.randomUUID()}_doc.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      pageCount: 1,
      status: 'ready',
    });
    await container.storage.put?.(file.storageKey, new Uint8Array([1, 2, 3]), 'application/pdf');

    // Schedule a cleanup 24h after collection — back-date it so it's due now.
    const past = new Date(Date.now() - 1000);
    await container.db.insert('fileCleanupTask', {
      id: crypto.randomUUID(),
      printFileId: file.id,
      shopId,
      storageKey: file.storageKey,
      cleanupType: 'after_collect',
      scheduledAt: past,
      status: 'pending',
    } as never);

    // Run the cron.
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(cronReq('GET', '/api/v1/cron/cleanup'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.completed).toBeGreaterThanOrEqual(1);

    // The storage object MUST be gone.
    const head = await container.storage.head(file.storageKey);
    expect(head).toBeNull();

    // The task is marked completed (not pending).
    const tasks = await container.db.findMany<{ status: string }>('fileCleanupTask', { printFileId: file.id });
    expect(tasks.every((t) => t.status === 'completed')).toBe(true);
  });

  it('does NOT delete a file whose scheduledAt is in the future', async () => {
    const order = await repos.orders.createWithUniqueToken(
      shopId,
      {
        customerPhone: null,
        notes: null,
        regenerateCustomerToken: () =>
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      },
      (c) => String(101 + c),
    );
    const file = await repos.files.create({
      orderId: order.id,
      originalFilename: 'doc.pdf',
      storageKey: `shops/${shopId}/orders/${order.id}/orig/${crypto.randomUUID()}_doc.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      pageCount: 1,
      status: 'ready',
    });
    await container.storage.put?.(file.storageKey, new Uint8Array([1, 2, 3]), 'application/pdf');

    // Schedule a cleanup 24h in the future — NOT due yet.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await container.db.insert('fileCleanupTask', {
      id: crypto.randomUUID(),
      printFileId: file.id,
      shopId,
      storageKey: file.storageKey,
      cleanupType: 'after_collect',
      scheduledAt: future,
      status: 'pending',
    } as never);

    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(cronReq('GET', '/api/v1/cron/cleanup'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.processed).toBe(0); // nothing was due

    // The storage object is still there.
    const head = await container.storage.head(file.storageKey);
    expect(head).not.toBeNull();
  });
});

// ── (b) Partial upload deletion (>1h old) ──

describe('Retention — /api/v1/cron/cleanup-uploads expires old sessions', () => {
  it('expires a partial upload session older than 1 hour', async () => {
    // Create a session, then move its lastChunkAt 2h into the past by
    // creating it 2h+ ago. The session registry timestamps at creation;
    // we simulate staleness by calling expireOldSessions with a future
    // "now" so the session's lastChunkAt is well past the 1h TTL.
    const uploadId = await createSession({
      fileId: crypto.randomUUID(),
      orderId: crypto.randomUUID(),
      orderToken: 'a'.repeat(64),
      shopId,
      filename: 'partial.pdf',
      mimeType: 'application/pdf',
      declaredSize: 100,
    });
    // Sanity: the session is active.
    expect((await import('@/lib/pipeline/upload-sessions')).activeSessionCount()).toBeGreaterThanOrEqual(1);

    // Move the clock 2h forward — the session is now > 1h old.
    const twoHoursLater = Date.now() + 2 * 60 * 60 * 1000;
    const expired = await expireOldSessions(twoHoursLater);
    expect(expired).toBeGreaterThanOrEqual(1);

    // The session is gone from the registry.
    expect((await import('@/lib/pipeline/upload-sessions')).getSession(uploadId)).toBeNull();
  });

  it('does NOT expire a session with recent chunk activity (< 1h)', async () => {
    const uploadId = await createSession({
      fileId: crypto.randomUUID(),
      orderId: crypto.randomUUID(),
      orderToken: 'b'.repeat(64),
      shopId,
      filename: 'fresh.pdf',
      mimeType: 'application/pdf',
      declaredSize: 100,
    });
    const expired = await expireOldSessions(Date.now() + 30 * 60 * 1000); // 30 min later
    expect(expired).toBe(0);
    expect((await import('@/lib/pipeline/upload-sessions')).getSession(uploadId)).not.toBeNull();
  });
});

// ── (c) Sensitive-document file deletion (right after printing) ──

describe('Retention — sensitive-document deletion via forced cleanup', () => {
  it('scheduleForcedCleanupForFile creates a forced task scheduled for NOW', async () => {
    const order = await repos.orders.createWithUniqueToken(
      shopId,
      {
        customerPhone: null,
        notes: null,
        regenerateCustomerToken: () =>
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      },
      (c) => String(102 + c),
    );
    const file = await repos.files.create({
      orderId: order.id,
      originalFilename: 'aadhaar.pdf',
      storageKey: `shops/${shopId}/orders/${order.id}/orig/${crypto.randomUUID()}_aadhaar.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      pageCount: 1,
      status: 'ready',
    });
    await container.storage.put?.(file.storageKey, new Uint8Array([1, 2, 3]), 'application/pdf');

    const before = Date.now();
    await scheduleForcedCleanupForFile(file.id, shopId, file.storageKey);
    const after = Date.now();

    // The forced cleanup task exists and is pending.
    const tasks = await container.db.findMany<{ cleanupType: string; scheduledAt: Date; status: string }>(
      'fileCleanupTask',
      { printFileId: file.id },
    );
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const forced = tasks.find((t) => t.cleanupType === 'forced');
    expect(forced).toBeDefined();
    expect(forced!.status).toBe('pending');
    // Scheduled for IMMEDIATE execution — the cron should pick it up on the
    // next tick (no 15-min grace period like the after_receipt flow).
    const scheduledAt = forced!.scheduledAt instanceof Date ? forced!.scheduledAt.getTime() : new Date(forced!.scheduledAt as unknown as string).getTime();
    expect(scheduledAt).toBeGreaterThanOrEqual(before - 1000);
    expect(scheduledAt).toBeLessThanOrEqual(after + 1000);
  });

  it('the /api/v1/cron/cleanup endpoint processes a forced task immediately', async () => {
    const order = await repos.orders.createWithUniqueToken(
      shopId,
      {
        customerPhone: null,
        notes: null,
        regenerateCustomerToken: () =>
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      },
      (c) => String(103 + c),
    );
    const file = await repos.files.create({
      orderId: order.id,
      originalFilename: 'pan.pdf',
      storageKey: `shops/${shopId}/orders/${order.id}/orig/${crypto.randomUUID()}_pan.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      pageCount: 1,
      status: 'ready',
    });
    await container.storage.put?.(file.storageKey, new Uint8Array([4, 5, 6]), 'application/pdf');

    // Schedule the forced cleanup.
    await scheduleForcedCleanupForFile(file.id, shopId, file.storageKey);

    // Run the cron — it should pick up the forced task on the same tick
    // (scheduledAt = now ≤ now).
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const res = await GET(cronReq('GET', '/api/v1/cron/cleanup'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.completed).toBeGreaterThanOrEqual(1);

    // The sensitive file's storage object is GONE — deleted right after printing.
    const head = await container.storage.head(file.storageKey);
    expect(head).toBeNull();
  });

  it('a forced cleanup task is created with the right metadata (shopId, storageKey)', async () => {
    const storageKey = `shops/${shopId}/orders/x/orig/y_sens.pdf`;
    const file = await repos.files.create({
      orderId: crypto.randomUUID(),
      originalFilename: 'sens.pdf',
      storageKey,
      mimeType: 'application/pdf',
      sizeBytes: 1,
      pageCount: 1,
      status: 'ready',
    });
    await scheduleForcedCleanupForFile(file.id, shopId, storageKey);
    const tasks = await container.db.findMany<{ shopId: string; storageKey: string; cleanupType: string }>(
      'fileCleanupTask',
      { printFileId: file.id },
    );
    const forced = tasks.find((t) => t.cleanupType === 'forced');
    expect(forced).toBeDefined();
    expect(forced!.shopId).toBe(shopId);
    expect(forced!.storageKey).toBe(storageKey);
  });
});

// ── Auth gate ──

describe('Retention — cron auth', () => {
  it('rejects a cron call with no Authorization header', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const req = new NextRequest('http://localhost:3000/api/v1/cron/cleanup');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('rejects a cron call with the wrong secret', async () => {
    const { GET } = await import('@/app/api/v1/cron/cleanup/route');
    const req = new NextRequest('http://localhost:3000/api/v1/cron/cleanup', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

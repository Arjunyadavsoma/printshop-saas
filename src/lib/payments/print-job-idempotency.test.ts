import { describe, expect, it, beforeEach } from 'vitest';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
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
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { enqueuePaidOrderPrint } from '@/lib/payments/webhook.service';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type Shop } from '@platform/core/domain';

/**
 * Idempotent PrintJob creation regression test.
 *
 * Defect being guarded against:
 *   The webhook service's enqueuePaidOrderPrint previously created a NEW
 *   PrintJob for each call, with no idempotency check. If the function was
 *   called twice (e.g., a concurrent duplicate webhook that slipped through
 *   the cache check, or a retry after a process crash), it would create
 *   DUPLICATE PrintJobs for the same file.
 *
 * Fix:
 *   enqueuePaidOrderPrint now calls repos.printJobs.findActiveByFile(fileId)
 *   before creating a new job. If an active ('queued' or 'printing') PrintJob
 *   already exists for the file, it re-dispatches but does NOT create a
 *   duplicate. 'completed' and 'needs_review' jobs do NOT block (a shopkeeper
 *   manually re-queuing a file SHOULD get a new PrintJob).
 *
 * This test verifies:
 *   1. Calling enqueuePaidOrderPrint once creates exactly 1 PrintJob.
 *   2. Calling it AGAIN (simulating a retry) does NOT create a duplicate —
 *      the existing 'queued' PrintJob is found and reused.
 *   3. After the job is 'completed', calling enqueuePaidOrderPrint AGAIN
 *      DOES create a new PrintJob (a reprint is a new job, not a duplicate).
 *   4. A 'needs_review' job does NOT block a new PrintJob creation (the
 *      shopkeeper's manual reprint gets a fresh job).
 */
describe('enqueuePaidOrderPrint — idempotent PrintJob creation', () => {
  let shopId: string;
  let orderId: string;
  let fileId: string;

  beforeEach(async () => {
    const db = new InMemoryDatabaseAdapter();
    const cache = new InMemoryCacheAdapter();
    const container: Container = {
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
      auth: new JwtAuthAdapter(
        { accessSecret: 'test-access-secret-min-32-chars-long', refreshSecret: 'test-refresh-secret-min-32-chars-long', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
        cache,
      ),
    };
    setContainerForTesting(container);

    const owner = await repos.users.create({ email: 'idempotency@test.demo', phone: '9999999999', password: 'pass1234', role: 'owner', shopId: null }, container.auth);
    const shop: Shop = {
      id: crypto.randomUUID(),
      name: 'Idempotency Test Shop',
      slug: 'idempotency-shop',
      ownerUserId: owner.id,
      upiId: 'idem@okaxis',
      paymentProvider: 'googlepay',
      paymentCredentials: {},
      pricingConfig: createDefaultPricingConfig(),
      address: 'x',
      phone: '9999999999',
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const created = await repos.shops.create(shop);
    shopId = created.id;
    await repos.users.update(owner.id, { shopId });

    const order = await repos.orders.create({ shopId, customerToken: 'TOKIDEM' });
    orderId = order.id;
    const file = await repos.files.create({
      orderId,
      originalFilename: 'doc.pdf',
      storageKey: 'k',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      pageCount: 1,
    });
    fileId = file.id;
  });

  it('creates exactly 1 PrintJob on the first call', async () => {
    await enqueuePaidOrderPrint(orderId, shopId);
    const jobs = await repos.printJobs.findQueuedByShop(shopId, 50);
    expect(jobs.length).toBe(1);
    expect(jobs[0].fileId).toBe(fileId);
    expect(jobs[0].status).toBe('queued');
  });

  it('does NOT create a duplicate on a second call (idempotent retry)', async () => {
    // First call — creates 1 PrintJob
    await enqueuePaidOrderPrint(orderId, shopId);
    // Second call — simulates a retry after a crash / concurrent duplicate webhook
    await enqueuePaidOrderPrint(orderId, shopId);
    const jobs = await repos.printJobs.findQueuedByShop(shopId, 50);
    expect(jobs.length).toBe(1);
    expect(jobs[0].fileId).toBe(fileId);
    expect(jobs[0].status).toBe('queued');
  });

  it('does NOT create a duplicate if the existing job is printing', async () => {
    // First call — creates 1 PrintJob (queued)
    await enqueuePaidOrderPrint(orderId, shopId);
    // Simulate the agent claiming it (status → printing)
    const [job] = await repos.printJobs.findQueuedByShop(shopId, 50);
    await repos.printJobs.update(job.id, { status: 'printing', agentId: 'agent-1', startedAt: new Date() });
    // Second call — the job is now 'printing', should NOT create a duplicate
    await enqueuePaidOrderPrint(orderId, shopId);
    // Verify: query all PrintJobs for this shop (findQueuedByShop only finds 'queued')
    const allJobs = await repos.printJobs.findAllByShop(shopId, 50);
    expect(allJobs.length).toBe(1);
    expect(allJobs[0].status).toBe('printing');
  });

  it('DOES create a new PrintJob after the previous one completed (reprint)', async () => {
    // First call — creates 1 PrintJob (queued)
    await enqueuePaidOrderPrint(orderId, shopId);
    // Simulate the agent completing it
    const [job] = await repos.printJobs.findQueuedByShop(shopId, 50);
    await repos.printJobs.update(job.id, { status: 'completed', completedAt: new Date() });
    // Second call — the previous job is 'completed', should create a NEW one
    await enqueuePaidOrderPrint(orderId, shopId);
    const allJobs = await repos.printJobs.findAllByShop(shopId, 50);
    expect(allJobs.length).toBe(2);
    expect(allJobs.some((j: { status: string }) => j.status === 'completed')).toBe(true);
    expect(allJobs.some((j: { status: string }) => j.status === 'queued')).toBe(true);
  });

  it('DOES create a new PrintJob if the previous one is needs_review (shopkeeper reprint)', async () => {
    // First call — creates 1 PrintJob (queued)
    await enqueuePaidOrderPrint(orderId, shopId);
    // Simulate the job going to needs_review (stale recovery)
    const [job] = await repos.printJobs.findQueuedByShop(shopId, 50);
    await repos.printJobs.update(job.id, { status: 'needs_review' });
    // Second call — needs_review does NOT block, creates a NEW job
    await enqueuePaidOrderPrint(orderId, shopId);
    const allJobs = await repos.printJobs.findAllByShop(shopId, 50);
    expect(allJobs.length).toBe(2);
    expect(allJobs.some((j: { status: string }) => j.status === 'needs_review')).toBe(true);
    expect(allJobs.some((j: { status: string }) => j.status === 'queued')).toBe(true);
  });
});

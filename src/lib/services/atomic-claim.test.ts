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
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { createDefaultPricingConfig, type Shop } from '@platform/core/domain';

let shopId: string;
let orderId: string;

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
    auth: new JwtAuthAdapter({ accessSecret: 'a', refreshSecret: 'b', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 }, cache),
  };
  setContainerForTesting(container);

  const shop = await repos.shops.create({
    id: crypto.randomUUID(),
    name: 'Test Shop',
    slug: 'test-' + crypto.randomUUID().slice(0, 8),
    ownerUserId: crypto.randomUUID(),
    upiId: 'test@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: {},
    pricingConfig: createDefaultPricingConfig() as never,
    address: 'x',
    phone: 'x',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: 'free',
    subscriptionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  shopId = shop.id;

  const order = await repos.orders.create({ shopId, customerToken: 'TEST01' });
  orderId = order.id;
  await repos.orders.update(order.id, { totalAmountPaise: 1000 });
});

/**
 * Atomic claim tests — simulate concurrent agents using the in-memory adapter.
 *
 * The in-memory adapter's `update` method does a single JavaScript operation
 * (find-matching-rows + apply-patch) which is atomic within a single
 * event-loop tick. Two `await` calls in a `Promise.all` are still sequential
 * at the DB level (JavaScript is single-threaded). So this test verifies the
 * APPLICATION-LEVEL logic (the conditional WHERE clause) is correct.
 *
 * For true PostgreSQL concurrency safety, the same conditional UPDATE
 * (`UPDATE ... WHERE id=? AND status='queued'`) must be verified against a
 * real PostgreSQL instance with actual concurrent connections. That test is
 * NOT possible in this sandbox (no PostgreSQL). The logic tested here is
 * identical — the PrismaDatabaseAdapter delegates to `updateMany` with the
 * same conditional filter, which is a single atomic SQL statement.
 */
describe('Atomic job claiming — concurrent agents', () => {
  it('only one agent wins the claim; the loser gets skipped', async () => {
    const db = getContainer().db;
    const file = await repos.files.create({ orderId, originalFilename: 'doc.pdf', storageKey: 'key', mimeType: 'application/pdf', sizeBytes: 100, pageCount: 1 });
    const job = await repos.printJobs.create({ shopId, fileId: file.id });

    // Agent A claims (conditional update WHERE id AND status='queued').
    const claimA = await db.update('printJob', { id: job.id, shopId, status: 'queued' }, { status: 'printing', agentId: 'agent-A', startedAt: new Date() });
    expect(claimA.length).toBe(1);
    expect(claimA[0]!.agentId).toBe('agent-A');

    // Agent B claims the SAME job — should fail (status is now 'printing').
    const claimB = await db.update('printJob', { id: job.id, shopId, status: 'queued' }, { status: 'printing', agentId: 'agent-B', startedAt: new Date() });
    expect(claimB.length).toBe(0); // no rows matched — the loser

    // Verify the job was claimed by A, not B.
    const final = await repos.printJobs.findByIdAndShop(job.id, shopId);
    expect(final?.status).toBe('printing');
    expect(final?.agentId).toBe('agent-A');
  });

  it('duplicate completion ack is idempotent (second is a no-op)', async () => {
    const db = getContainer().db;
    const file = await repos.files.create({ orderId, originalFilename: 'doc2.pdf', storageKey: 'key2', mimeType: 'application/pdf', sizeBytes: 100, pageCount: 1 });
    const job = await repos.printJobs.create({ shopId, fileId: file.id });

    // Claim + complete.
    await db.update('printJob', { id: job.id, shopId, status: 'queued' }, { status: 'printing', agentId: 'agent-A', startedAt: new Date() });
    const complete1 = await db.update('printJob', { id: job.id, shopId, status: 'printing' }, { status: 'completed', completedAt: new Date() });
    expect(complete1.length).toBe(1);

    // Duplicate completion ack — the job is already 'completed', not 'printing'.
    const complete2 = await db.update('printJob', { id: job.id, shopId, status: 'printing' }, { status: 'completed', completedAt: new Date() });
    expect(complete2.length).toBe(0); // no rows matched — idempotent no-op

    // The job is still completed (not corrupted by the duplicate).
    const final = await repos.printJobs.findByIdAndShop(job.id, shopId);
    expect(final?.status).toBe('completed');
  });

  it('cannot claim a needs_review job (requires manual re-queue)', async () => {
    const db = getContainer().db;
    const file = await repos.files.create({ orderId, originalFilename: 'doc3.pdf', storageKey: 'key3', mimeType: 'application/pdf', sizeBytes: 100, pageCount: 1 });
    const job = await repos.printJobs.create({ shopId, fileId: file.id });
    await repos.printJobs.update(job.id, { status: 'needs_review' });

    // Agent tries to claim — should fail (status is 'needs_review', not 'queued').
    const claim = await db.update('printJob', { id: job.id, shopId, status: 'queued' }, { status: 'printing', agentId: 'agent-X', startedAt: new Date() });
    expect(claim.length).toBe(0);
  });

  it('cross-tenant claim is rejected (different shopId)', async () => {
    const db = getContainer().db;
    const file = await repos.files.create({ orderId, originalFilename: 'doc4.pdf', storageKey: 'key4', mimeType: 'application/pdf', sizeBytes: 100, pageCount: 1 });
    const job = await repos.printJobs.create({ shopId, fileId: file.id });

    // Agent from a different shop tries to claim — filter includes shopId.
    const claim = await db.update('printJob', { id: job.id, shopId: 'wrong-shop-id', status: 'queued' }, { status: 'printing', agentId: 'evil-agent', startedAt: new Date() });
    expect(claim.length).toBe(0); // no rows matched (shopId mismatch)

    // The job is still 'queued' (untouched).
    const final = await repos.printJobs.findByIdAndShop(job.id, shopId);
    expect(final?.status).toBe('queued');
    expect(final?.agentId).toBeNull();
  });
});

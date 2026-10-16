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
import { recoverStaleJobs, requeueJob, markJobCompleted } from '@/lib/services/durable-queue';

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
    logger: new JsonConsoleLogger({ service: 'test' }),
    auth: new JwtAuthAdapter({ accessSecret: 'a', refreshSecret: 'b', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 }, cache),
  };
  setContainerForTesting(container);

  // Create a shop + order + file + print job.
  const shop = await repos.shops.create({
    id: crypto.randomUUID(),
    name: 'Test Shop',
    slug: 'test-' + crypto.randomUUID().slice(0, 8),
    ownerUserId: crypto.randomUUID(),
    upiId: 'test@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: {},
    pricingConfig: { bw_a4_per_page: 200, color_a4_per_page: 600, bw_a3_per_page: 400, color_a3_per_page: 1200, bw_letter_per_page: 200, color_letter_per_page: 600, bw_legal_per_page: 250, color_legal_per_page: 700, duplex_discount: 10, bulk_threshold: 100, bulk_discount_pct: 5, min_order_value: 0 } as never,
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

describe('Durable queue — stale job recovery', () => {
  it('moves a stale printing job to needs_review (not queued)', async () => {
    // Create a job that started 10 minutes ago (stale).
    const job = await repos.printJobs.create({ shopId, fileId: 'file-1' });
    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    await repos.printJobs.update(job.id, { status: 'printing', startedAt: oldDate });

    const count = await recoverStaleJobs(shopId);
    expect(count).toBe(1);

    const updated = await repos.printJobs.findByIdAndShop(job.id, shopId);
    expect(updated?.status).toBe('needs_review');
  });

  it('does NOT move a recently-started printing job (under threshold)', async () => {
    const job = await repos.printJobs.create({ shopId, fileId: 'file-2' });
    await repos.printJobs.update(job.id, { status: 'printing', startedAt: new Date() });

    const count = await recoverStaleJobs(shopId);
    expect(count).toBe(0);

    const updated = await repos.printJobs.findByIdAndShop(job.id, shopId);
    expect(updated?.status).toBe('printing');
  });

  it('does NOT touch completed jobs', async () => {
    const job = await repos.printJobs.create({ shopId, fileId: 'file-3' });
    await repos.printJobs.update(job.id, { status: 'completed', completedAt: new Date() });

    const count = await recoverStaleJobs(shopId);
    expect(count).toBe(0);
  });
});

describe('Durable queue — manual review actions', () => {
  it('requeues from needs_review → queued', async () => {
    const job = await repos.printJobs.create({ shopId, fileId: 'file-4' });
    await repos.printJobs.update(job.id, { status: 'needs_review' });

    await requeueJob(job.id, shopId);
    const updated = await repos.printJobs.findByIdAndShop(job.id, shopId);
    expect(updated?.status).toBe('queued');
  });

  it('marks needs_review → completed', async () => {
    const file = await repos.files.create({ orderId, originalFilename: 'test.pdf', storageKey: 'key', mimeType: 'application/pdf', sizeBytes: 100, pageCount: 1 });
    const job = await repos.printJobs.create({ shopId, fileId: file.id });
    await repos.printJobs.update(job.id, { status: 'needs_review' });

    await markJobCompleted(job.id, shopId, file.id);
    const updated = await repos.printJobs.findByIdAndShop(job.id, shopId);
    expect(updated?.status).toBe('completed');
    const updatedFile = await repos.files.findByIdAndOrder(file.id, orderId);
    expect(updatedFile?.status).toBe('completed');
  });
});

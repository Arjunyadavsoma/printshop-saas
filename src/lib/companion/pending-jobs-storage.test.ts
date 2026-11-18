import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the db module to prevent PrismaClient from being created with an
// invalid SQLite URL (same pattern as companion-api.test.ts).
vi.mock('@/lib/db', () => ({ db: {} }));

process.env.DATABASE_PROVIDER = 'memory';
process.env.STORAGE_PROVIDER = 'memory';

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { hashDeviceToken } from '@/lib/api/device-token';

let shopId: string;
let deviceToken: string;
let testIp: string;

function deviceReq(method: string, path: string, token: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
  } as never);
}

async function seedShopAndAgent() {
  const container = getContainer();
  const auth = container.auth;
  const owner = await repos.users.create(
    { email: `p2-1-${Date.now()}-${Math.random()}@test.com`, phone: '5555555555', password: 'testpass', role: 'owner', shopId: null },
    auth,
  );
  const sid = crypto.randomUUID();
  await repos.shops.create({
    id: sid, name: 'Pending Shop', slug: `pj-${sid.slice(0, 8)}`, ownerUserId: owner.id,
    upiId: 'shop@okaxis', paymentProvider: 'googlepay', paymentCredentials: {},
    pricingConfig: {}, address: 'a', phone: 'p', timezone: 'Asia/Kolkata', isActive: true,
    subscriptionTier: 'free', subscriptionExpiresAt: null,
  } as never);
  await repos.users.update(owner.id, { shopId: sid } as never);
  const aid = crypto.randomUUID();
  deviceToken = crypto.randomUUID() + '-' + crypto.randomUUID();
  await container.db.insert('printAgent', {
    id: aid, shopId: sid, name: 'Pending Device',
    tokenHash: hashDeviceToken(deviceToken),
    prevTokenHash: null, tokenRotatedAt: null,
    lastSeenAt: null, printerName: 'Shop LaserJet', isOnline: false, isEnabled: true,
    version: null, os: 'win32', createdAt: new Date(), updatedAt: new Date(),
  });
  return { sid, aid };
}

/** Seed an order + file (+ optional job) and return the ids. */
async function seedOrderFileJob(opts: { storageKey?: string; skipFile?: boolean; status?: string }) {
  const container = getContainer();
  const orderId = crypto.randomUUID();
  await container.db.insert('order', {
    id: orderId, shopId, customerToken: 'tok-' + orderId.slice(0, 8), status: 'paid',
    totalAmountPaise: 10000, currency: 'INR', createdAt: new Date(), updatedAt: new Date(),
  });
  const fileId = crypto.randomUUID();
  if (!opts.skipFile) {
    await container.db.insert('printFile', {
      id: fileId, orderId, originalFilename: 'doc.pdf', storageKey: opts.storageKey ?? 'shop/doc.pdf',
      mimeType: 'application/pdf', sizeBytes: 1000, pageCount: 1, copies: 1,
      colorMode: 'bw', duplex: false, paperSize: 'a4', pageRange: null,
      status: 'queued', createdAt: new Date(), updatedAt: new Date(),
    } as never);
  }
  const jobId = crypto.randomUUID();
  await container.db.insert('printJob', {
    id: jobId, shopId, fileId, agentId: null, status: opts.status ?? 'queued',
    attempts: 0, lastError: null, queuedAt: new Date(), startedAt: null, completedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
  return { orderId, fileId, jobId };
}

beforeEach(async () => {
  testIp = `10.2.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  const seeded = await seedShopAndAgent();
  shopId = seeded.sid;
});

describe('Phase 3 §4 (P2-1) — /agents/jobs/pending storage failure handling', () => {
  it('1. happy path: presigned relative URL resolves against APP_BASE_URL', async () => {
    const { jobId } = await seedOrderFileJob({});
    const container = getContainer();
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async () => '/api/v1/storage/get?key=shop/doc.pdf&sig=x',
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const res = await GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.jobs[0].jobId).toBe(jobId);
    expect(body.data.jobs[0].downloadUrl).toContain('/api/v1/storage/get?key=shop/doc.pdf');
    expect(body.data.failedJobs).toHaveLength(0);
  });

  it('2. storage provider failure → 503 STORAGE_UNAVAILABLE, machine-readable, job stays queued', async () => {
    const { jobId } = await seedOrderFileJob({});
    const container = getContainer();
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async () => { throw new Error('SigV4 credential failure: secret key rotated (INTERNAL)'); },
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const res = await GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(body.error.details.retryable).toBe(true);
    expect(body.error.details.failedJobs[0].jobId).toBe(jobId);
    expect(body.error.details.failedJobs[0].code).toBe('STORAGE_UNAVAILABLE');
    // No provider internals leak into the response.
    expect(JSON.stringify(body)).not.toContain('SigV4');
    expect(JSON.stringify(body)).not.toContain('secret key rotated');
    // The job was NOT consumed — it stays queued for retry.
    const job = await container.db.findOne<{ status: string }>('printJob', { id: jobId });
    expect(job?.status).toBe('queued');
  });

  it('3. partial failure: one bad document does not corrupt unrelated jobs', async () => {
    const good = await seedOrderFileJob({ storageKey: 'shop/good.pdf' });
    const bad = await seedOrderFileJob({ storageKey: 'shop/bad.pdf' });
    const container = getContainer();
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async (key: string) => {
        if (String(key).includes('bad')) throw new Error('object not found');
        return '/api/v1/storage/get?ok=1';
      },
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const res = await GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.jobs[0].jobId).toBe(good.jobId);
    expect(body.data.failedJobs).toHaveLength(1);
    expect(body.data.failedJobs[0].jobId).toBe(bad.jobId);
    expect(body.data.failedJobs[0].code).toBe('STORAGE_UNAVAILABLE');
    const badJob = await container.db.findOne<{ status: string }>('printJob', { id: bad.jobId });
    expect(badJob?.status).toBe('queued');
  });

  it('4. document missing → DOCUMENT_MISSING (200, not silent-empty)', async () => {
    const { jobId } = await seedOrderFileJob({ skipFile: true });
    const container = getContainer();
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async () => '/never-called',
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const res = await GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.jobs).toHaveLength(0);
    expect(body.data.failedJobs).toHaveLength(1);
    expect(body.data.failedJobs[0].code).toBe('DOCUMENT_MISSING');
    expect(body.data.failedJobs[0].jobId).toBe(jobId);
  });

  it('5. job with no storageKey → JOB_INVALID', async () => {
    await seedOrderFileJob({ storageKey: '' });
    const container = getContainer();
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async () => '/never-called',
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const res = await GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.failedJobs[0].code).toBe('JOB_INVALID');
  });

  it('7. storage provider TIMEOUT (ETIMEDOUT-shaped failure) → same safe classification', async () => {
    const { jobId } = await seedOrderFileJob({});
    const container = getContainer();
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async () => {
        const err = new Error('connect ETIMEDOUT 1.2.3.4:443');
        (err as { code?: string }).code = 'ETIMEDOUT';
        throw err;
      },
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const res = await GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(body.error.details.failedJobs[0].jobId).toBe(jobId);
    expect(JSON.stringify(body)).not.toContain('ETIMEDOUT');
    expect(JSON.stringify(body)).not.toContain('1.2.3.4');
    const job = await container.db.findOne<{ status: string }>('printJob', { id: jobId });
    expect(job?.status).toBe('queued');
  });

  it('8. RECOVERY after temporary storage failure → next poll delivers the same job (not discarded)', async () => {
    const { jobId } = await seedOrderFileJob({});
    const container = getContainer();
    let healthy = false;
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async () => {
        if (!healthy) throw new Error('temporary provider outage');
        return '/api/v1/storage/get?recovered=1';
      },
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const req = () => GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    // First poll: outage → 503, job stays queued.
    const r1 = await req();
    expect(r1.status).toBe(503);
    let job = await container.db.findOne<{ status: string }>('printJob', { id: jobId });
    expect(job?.status).toBe('queued');
    // Storage recovers; next poll delivers the SAME job.
    healthy = true;
    const r2 = await req();
    expect(r2.status).toBe(200);
    const body = await r2.json();
    expect(body.data.jobs.map((j: { jobId: string }) => j.jobId)).toContain(jobId);
    expect(body.data.failedJobs).toHaveLength(0);
  });

  it('6. genuinely empty queue → 200 with empty jobs (real empty, not masked failure)', async () => {
    const container = getContainer();
    (container as { storage: unknown }).storage = {
      getPresignedDownloadUrl: async () => '/never-called',
    };
    const { GET } = await import('@/app/api/v1/agents/jobs/pending/route');
    const res = await GET(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.jobs).toHaveLength(0);
    expect(body.data.failedJobs).toHaveLength(0);
  });
});

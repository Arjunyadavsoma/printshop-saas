import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the db module to prevent PrismaClient from being created with an
// invalid SQLite URL (same pattern as companion-api.test.ts).
vi.mock('@/lib/db', () => ({ db: {} }));

process.env.DATABASE_PROVIDER = 'memory';
process.env.STORAGE_PROVIDER = 'memory';

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { hashDeviceToken, legacyDeviceTokenHash, assertDeviceTokenPepperConfigured } from '@/lib/api/device-token';

let shopId: string;
let ownerToken: string;
let agentId: string;
let deviceToken: string;
let jobId: string;
let fileId: string;
let testIp: string;

async function seedShopAndAgent(agentHash?: string, rotateAt?: Date) {
  const container = getContainer();
  const auth = container.auth;
  const owner = await repos.users.create(
    { email: `rot-${Date.now()}-${Math.random()}@test.com`, phone: '5555555555', password: 'testpass', role: 'owner', shopId: null },
    auth,
  );
  const sid = crypto.randomUUID();
  await repos.shops.create({
    id: sid, name: 'Rot Shop', slug: `rot-${sid.slice(0, 8)}`, ownerUserId: owner.id,
    upiId: 'shop@okaxis', paymentProvider: 'googlepay', paymentCredentials: {},
    pricingConfig: {}, address: 'a', phone: 'p', timezone: 'Asia/Kolkata', isActive: true,
    subscriptionTier: 'free', subscriptionExpiresAt: null,
  } as never);
  await repos.users.update(owner.id, { shopId: sid } as never);
  const access = await auth.issueAccessToken({ id: owner.id, shopId: sid, role: 'owner' });

  const aid = crypto.randomUUID();
  await container.db.insert('printAgent', {
    id: aid, shopId: sid, name: 'Device Under Test',
    tokenHash: agentHash ?? hashDeviceToken(deviceToken),
    prevTokenHash: null, tokenRotatedAt: rotateAt ?? null,
    lastSeenAt: null, printerName: null, isOnline: false, isEnabled: true,
    version: null, os: 'win32', createdAt: new Date(), updatedAt: new Date(),
  });
  return { sid, aid, ownerToken: access.token };
}

async function seedJob(status: string, claimedBy?: string) {
  const container = getContainer();
  const orderId = crypto.randomUUID();
  await container.db.insert('order', {
    id: orderId, shopId, customerToken: 'tok-' + orderId.slice(0, 8), status: 'paid',
    totalAmountPaise: 10000, currency: 'INR', createdAt: new Date(), updatedAt: new Date(),
  });
  const fid = crypto.randomUUID();
  await container.db.insert('printFile', {
    id: fid, orderId, originalFilename: 'doc.pdf', storageKey: 'k', mimeType: 'application/pdf',
    sizeBytes: 10, copies: 1, colorMode: 'bw', paperSize: 'a4', pricePaise: 10000,
    status: status === 'queued' ? 'queued' : 'printing', pageCountSource: 'placeholder',
    createdAt: new Date(), updatedAt: new Date(),
  });
  const jid = crypto.randomUUID();
  await container.db.insert('printJob', {
    id: jid, shopId, fileId: fid, agentId: claimedBy ?? null, status,
    attempts: 0, lastError: null, queuedAt: new Date(), startedAt: claimedBy ? new Date() : null,
    completedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  fileId = fid; jobId = jid;
}

function deviceReq(method: string, path: string, token: string, body?: unknown) {
  const init: any = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost:3000${path}`, init);
}

beforeEach(async () => {
  testIp = `10.1.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  deviceToken = crypto.randomUUID() + '-' + crypto.randomUUID();
  const seeded = await seedShopAndAgent();
  shopId = seeded.sid; agentId = seeded.aid; ownerToken = seeded.ownerToken;
  await seedJob('queued');
});

describe('Phase C — token rotation lifecycle', () => {
  it('1. successful rotation returns a new token once and stores a v2 verifier', async () => {
    const { POST } = await import('@/app/api/v1/companion/token/rotate/route');
    const res = await POST(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.deviceToken).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.deviceToken).not.toBe(deviceToken);
    const row = await getContainer().db.findOne<{ tokenHash: string; prevTokenHash: string }>('printAgent', { id: agentId });
    expect(row!.tokenHash.startsWith('v2:')).toBe(true);
    expect(row!.prevTokenHash).toBe(hashDeviceToken(deviceToken));
  });

  it('2. old token DURING overlap: heartbeat allowed, read-only allowed, mutations rejected', async () => {
    const { POST: rotate } = await import('@/app/api/v1/companion/token/rotate/route');
    const r1 = await rotate(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) });
    expect(r1.status).toBe(200);
    const newToken = (await r1.json()).data.deviceToken as string;

    const { POST: heartbeat } = await import('@/app/api/v1/agents/heartbeat/route');
    const hb = await heartbeat(deviceReq('POST', '/api/v1/agents/heartbeat', deviceToken, {}), { params: Promise.resolve({}) });
    expect(hb.status).toBe(200);

    const { GET: pending } = await import('@/app/api/v1/agents/jobs/pending/route');
    const pr = await pending(deviceReq('GET', '/api/v1/agents/jobs/pending', deviceToken), { params: Promise.resolve({}) });
    expect(pr.status).toBe(200);

    // Mutation with the PREVIOUS token must be rejected (read-only overlap)
    const { POST: status } = await import('@/app/api/v1/agents/jobs/[id]/status/route');
    const st = await status(deviceReq('POST', `/api/v1/agents/jobs/${jobId}/status`, deviceToken, { status: 'printing' }),
      { params: Promise.resolve({ id: jobId }) });
    expect(st.status).toBe(403);
    const sj = await st.json();
    // ForbiddenError maps to code FORBIDDEN; the specific policy is in the message.
    expect(sj.error.message).toContain('TOKEN_OVERLAP_READ_ONLY');
    void newToken;
  });

  it('3. old token AFTER the overlap window expires is fully rejected', async () => {
    const staleToken = deviceToken;
    // Re-seed the agent with a rotation timestamp 20 minutes in the past
    await getContainer().db.update('printAgent', { id: agentId },
      { tokenHash: hashDeviceToken('new-cred'), prevTokenHash: hashDeviceToken(staleToken), tokenRotatedAt: new Date(Date.now() - 20 * 60 * 1000) });
    const { POST: heartbeat } = await import('@/app/api/v1/agents/heartbeat/route');
    const hb = await heartbeat(deviceReq('POST', '/api/v1/agents/heartbeat', staleToken, {}), { params: Promise.resolve({}) });
    expect(hb.status).toBe(401);
  });

  it('4. revoked (deleted) token is rejected', async () => {
    await getContainer().db.delete('printAgent', { id: agentId });
    const { POST: heartbeat } = await import('@/app/api/v1/agents/heartbeat/route');
    const hb = await heartbeat(deviceReq('POST', '/api/v1/agents/heartbeat', deviceToken, {}), { params: Promise.resolve({}) });
    expect(hb.status).toBe(401);
  });

  it('5. disabled device is rejected with DEVICE_DISABLED even for rotation recovery', async () => {
    await getContainer().db.update('printAgent', { id: agentId }, { isEnabled: false });
    const { POST: rotate } = await import('@/app/api/v1/companion/token/rotate/route');
    const res = await rotate(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain('DEVICE_DISABLED');
  });

  it('6. concurrent rotation: exactly one succeeds, loser gets 409 ROTATION_CONFLICT', async () => {
    const { POST: rotate } = await import('@/app/api/v1/companion/token/rotate/route');
    const [a, b] = await Promise.all([
      rotate(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) }),
      rotate(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error.code).toBe('ROTATION_CONFLICT');
  });

  it('7. replayed old token after a second rotation is fully rejected', async () => {
    const { POST: rotate } = await import('@/app/api/v1/companion/token/rotate/route');
    const r1 = await rotate(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) });
    expect(r1.status).toBe(200);
    const t1 = (await r1.json()).data.deviceToken as string;
    const r2 = await rotate(deviceReq('POST', '/api/v1/companion/token/rotate', t1, {}), { params: Promise.resolve({}) });
    expect(r2.status).toBe(200);
    // The FIRST token is two generations old now — prevTokenHash was overwritten.
    const hb = await import('@/app/api/v1/agents/heartbeat/route');
    const res = await hb.POST(deviceReq('POST', '/api/v1/agents/heartbeat', deviceToken, {}), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it('8. lost rotation response: retry with the old token inside the overlap succeeds', async () => {
    const { POST: rotate } = await import('@/app/api/v1/companion/token/rotate/route');
    // "Lost" the first response — the server rotated but we never stored it.
    const r1 = await rotate(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) });
    expect(r1.status).toBe(200);
    // Retry with the still-valid previous credential → a NEW token is issued.
    const r2 = await rotate(deviceReq('POST', '/api/v1/companion/token/rotate', deviceToken, {}), { params: Promise.resolve({}) });
    expect(r2.status).toBe(200);
    const t2 = (await r2.json()).data.deviceToken as string;
    const { POST: heartbeat } = await import('@/app/api/v1/agents/heartbeat/route');
    const hb = await heartbeat(deviceReq('POST', '/api/v1/agents/heartbeat', t2, {}), { params: Promise.resolve({}) });
    expect(hb.status).toBe(200);
  });

  it('9. legacy-format credential verifies and rotation migrates it to v2', async () => {
    const legacyToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const { sid, aid } = await seedShopAndAgent(legacyDeviceTokenHash(legacyToken));
    void sid;
    const { POST: rotate } = await import('@/app/api/v1/companion/token/rotate/route');
    const res = await rotate(deviceReq('POST', '/api/v1/companion/token/rotate', legacyToken, {}), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const row = await getContainer().db.findOne<{ tokenHash: string }>('printAgent', { id: aid });
    expect(row!.tokenHash.startsWith('v2:')).toBe(true);
  });

  it('10. pepper validation fails fast in production without DEVICE_TOKEN_PEPPER', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPepper = process.env.DEVICE_TOKEN_PEPPER;
    try {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      delete process.env.DEVICE_TOKEN_PEPPER;
      expect(() => assertDeviceTokenPepperConfigured()).toThrow(/DEVICE_TOKEN_PEPPER/);
      process.env.DEVICE_TOKEN_PEPPER = 'a'.repeat(32);
      expect(() => assertDeviceTokenPepperConfigured()).not.toThrow();
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prevNodeEnv;
      if (prevPepper === undefined) delete process.env.DEVICE_TOKEN_PEPPER; else process.env.DEVICE_TOKEN_PEPPER = prevPepper;
    }
  });
});

describe('Phase D — job state machine', () => {
  const statusRoute = async (token: string, body: unknown) => {
    const { POST } = await import('@/app/api/v1/agents/jobs/[id]/status/route');
    return POST(deviceReq('POST', `/api/v1/agents/jobs/${jobId}/status`, token, body), { params: Promise.resolve({ id: jobId }) });
  };
  const resolveRoute = async (ownerJwt: string, body: unknown) => {
    const { POST } = await import('@/app/api/v1/shops/me/jobs/[jobId]/resolve/route');
    return POST(new NextRequest(`http://localhost:3000/api/v1/shops/me/jobs/${jobId}/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
      body: JSON.stringify(body),
      // @ts-expect-error test-only dual binding
      dual: false,
    }), { params: Promise.resolve({ jobId }) });
  };

  it('11. claim → completed; duplicate completed is idempotent-skipped', async () => {
    let res = await statusRoute(deviceToken, { status: 'printing' });
    expect((await res.json()).data.applied).toBe(true);
    res = await statusRoute(deviceToken, { status: 'completed' });
    expect(res.status).toBe(200);
    res = await statusRoute(deviceToken, { status: 'completed' });
    const j = await res.json();
    expect(j.data.skipped).toBe(true);
    expect(j.data.reason).toContain('duplicate ack or already completed');
  });

  it('12. uncertain outcome: printing → needs_review; file status NOT collided', async () => {
    await statusRoute(deviceToken, { status: 'printing' });
    const res = await statusRoute(deviceToken, { status: 'needs_review', lastError: 'spooler timeout' });
    expect((await res.json()).data.applied).toBe(true);
    const job = await getContainer().db.findOne<{ status: string }>('printJob', { id: jobId });
    expect(job!.status).toBe('needs_review');
    const file = await getContainer().db.findOne<{ status: string }>('printFile', { id: fileId });
    // Phase A defect fix: the file must NOT carry 'needs_review' (page-count
    // review panels interpret that as "set page count"); it stays 'printing'.
    expect(file!.status).toBe('printing');
    // Duplicate needs_review is skipped honestly.
    const dup = await statusRoute(deviceToken, { status: 'needs_review' });
    expect((await dup.json()).data.skipped).toBe(true);
  });

  it('13. needs_review from queued is allowed (crash recovery before claim)', async () => {
    const res = await statusRoute(deviceToken, { status: 'needs_review', lastError: 'device restarted' });
    expect((await res.json()).data.applied).toBe(true);
    const job = await getContainer().db.findOne<{ status: string }>('printJob', { id: jobId });
    expect(job!.status).toBe('needs_review');
  });

  it('14. completed from needs_review (operator/device resolution path) applies', async () => {
    await seedJob('printing', agentId);
    await statusRoute(deviceToken, { status: 'needs_review' });
    const res = await statusRoute(deviceToken, { status: 'completed' });
    expect((await res.json()).data.applied).toBe(true);
    const job = await getContainer().db.findOne<{ status: string }>('printJob', { id: jobId });
    expect(job!.status).toBe('completed');
    const file = await getContainer().db.findOne<{ status: string }>('printFile', { id: fileId });
    expect(file!.status).toBe('completed');
  });

  it('15. invalid transition: completed on a queued job is rejected (skipped)', async () => {
    await seedJob('queued');
    const res = await statusRoute(deviceToken, { status: 'completed' });
    const j = await res.json();
    expect(j.data.skipped).toBe(true);
  });

  it('16. ownership: another shop\'s device cannot touch this job (404)', async () => {
    const otherToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    await seedShopAndAgent(hashDeviceToken(otherToken));
    const res = await statusRoute(otherToken, { status: 'printing' });
    expect(res.status).toBe(404);
  });

  it('17. skip reason distinguishes crash-leftover from live race loss', async () => {
    // Crash-leftover: the job's agentId IS this device, status 'printing'
    await seedJob('printing', agentId);
    const other = await statusRoute(deviceToken, { status: 'printing' });
    const oj = await other.json();
    expect(oj.data.skipped).toBe(true);
    expect(oj.data.reason).toContain('crash recovery');
    // Live race loss: job claimed by a DIFFERENT agent
    const rivalToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const rival = await seedShopAndAgent(hashDeviceToken(rivalToken));
    await seedJob('printing', rival.aid);
    const rl = await statusRoute(deviceToken, { status: 'printing' });
    const rlj = await rl.json();
    expect(rlj.data.skipped).toBe(true);
    expect(rlj.data.reason).toContain('already claimed by another agent');
  });

  it('18. operator resolution endpoint: needs_review → completed, audited with WHO', async () => {
    await seedJob('printing', agentId);
    await statusRoute(deviceToken, { status: 'needs_review' });
    const res = await resolveRoute(ownerToken, { outcome: 'completed', note: 'paper was in the tray' });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.data.status).toBe('completed');
    const audit = await getContainer().db.findMany<{ action: string; userId: string | null }>('auditLog', { action: 'job.resolved', entityId: jobId });
    expect(audit.length).toBe(1);
    expect(audit[0].userId).toBeTruthy();
    // Resolving again is refused (terminal state)
    const res2 = await resolveRoute(ownerToken, { outcome: 'completed' });
    expect(res2.status).toBe(409);
    expect((await res2.json()).error.code).toBe('JOB_NOT_IN_NEEDS_REVIEW');
  });

  it('19. operator resolution on a non-needs_review job is 409', async () => {
    await seedJob('queued');
    const res = await resolveRoute(ownerToken, { outcome: 'failed' });
    expect(res.status).toBe(409);
  });
});

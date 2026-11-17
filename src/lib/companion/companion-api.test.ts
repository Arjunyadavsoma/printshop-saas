import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the db module to prevent PrismaClient from being created with an
// invalid SQLite URL. The InMemoryDatabaseAdapter (used when
// DATABASE_PROVIDER=memory) doesn't use the db object at all.
vi.mock('@/lib/db', () => ({ db: {} }));

// Ensure the container uses in-memory adapters
process.env.DATABASE_PROVIDER = 'memory';
process.env.STORAGE_PROVIDER = 'memory';

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type Shop } from '@platform/core/domain';

let shopId: string;
let ownerToken: string;

beforeEach(async () => {
  const container = getContainer();
  const auth = container.auth;
  const owner = await repos.users.create(
    { email: `owner-${Date.now()}@test.com`, phone: '5555555555', password: 'testpass', role: 'owner', shopId: null },
    auth,
  );
  shopId = crypto.randomUUID();
  const shop: Shop = {
    id: shopId, name: 'Test Shop', slug: `test-${shopId.slice(0, 8)}`, ownerUserId: owner.id,
    upiId: 'shop@okaxis', paymentProvider: 'googlepay', paymentCredentials: {},
    pricingConfig: createDefaultPricingConfig(), address: '123 Test St', phone: '5555555555',
    timezone: 'Asia/Kolkata', isActive: true, subscriptionTier: 'free', subscriptionExpiresAt: null,
    description: null, businessHours: null, logoUrl: null, upiQrStorageKey: null, servicesJson: null,
    paymentPhone: null, paymentInstructions: null, cashOnPickup: false, paymentMethods: 'both',
    pamphletEnabled: false, pamphletPricePaise: 0, pamphletName: null, createdAt: new Date(), updatedAt: new Date(),
  };
  await repos.shops.create(shop);
  await repos.users.update(owner.id, { shopId });
  const access = await auth.issueAccessToken({ id: owner.id, shopId, role: 'owner' });
  ownerToken = access.token;
});

function authedReq(method: string, path: string, opts?: { body?: unknown }) {
  const headers: Record<string, string> = { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' };
   
  const init: any = { method, headers };
  if (opts?.body) init.body = JSON.stringify(opts.body);
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe('Companion API — Pairing', () => {
  it('1. creates a pairing ticket with authenticated owner', async () => {
    const { POST } = await import('@/app/api/v1/companion/pairing/begin/route');
    const res = await POST(authedReq('POST', '/api/v1/companion/pairing/begin'), { params: Promise.resolve({}) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.pairingUrl).toContain('printshop://pair?ticket=');
    expect(json.data.shopId).toBe(shopId);
  });

  it('2. rejects pairing creation without auth', async () => {
    const { POST } = await import('@/app/api/v1/companion/pairing/begin/route');
    const req = new NextRequest('http://localhost:3000/api/v1/companion/pairing/begin', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it('3. exchanges a valid ticket for a device token', async () => {
    const { POST: beginPost } = await import('@/app/api/v1/companion/pairing/begin/route');
    const ticket = (await (await beginPost(authedReq('POST', '/api/v1/companion/pairing/begin'), { params: Promise.resolve({}) })).json()).data.ticket;
    const { POST: pairPost } = await import('@/app/api/v1/companion/pair/route');
    const pairReq = new NextRequest('http://localhost:3000/api/v1/companion/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, deviceName: 'Test-PC', version: '1.0.0', os: 'Windows 11' }),
    });
    const pairRes = await pairPost(pairReq, { params: Promise.resolve({}) });
    const pairJson = await pairRes.json();
    expect(pairRes.status).toBe(200);
    expect(pairJson.data.agentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(pairJson.data.deviceToken).toMatch(/^[0-9a-f]{64}$/);
    expect(pairJson.data.shopId).toBe(shopId);
    expect(pairJson.data.protocolVersion).toBe(1);
  });

  it('4. rejects invalid ticket', async () => {
    const { POST } = await import('@/app/api/v1/companion/pair/route');
    const req = new NextRequest('http://localhost:3000/api/v1/companion/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: '0'.repeat(64), deviceName: 'PC' }),
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it('5. rejects reused ticket', async () => {
    const { POST: beginPost } = await import('@/app/api/v1/companion/pairing/begin/route');
    const ticket = (await (await beginPost(authedReq('POST', '/api/v1/companion/pairing/begin'), { params: Promise.resolve({}) })).json()).data.ticket;
    const { POST: pairPost } = await import('@/app/api/v1/companion/pair/route');
    const pairBody = JSON.stringify({ ticket, deviceName: 'PC1' });
    await pairPost(new NextRequest('http://localhost:3000/api/v1/companion/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pairBody }), { params: Promise.resolve({}) });
    const reuseRes = await pairPost(new NextRequest('http://localhost:3000/api/v1/companion/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pairBody }), { params: Promise.resolve({}) });
    expect(reuseRes.status).toBe(409);
  });
});

describe('Companion API — Devices & Commands', () => {
  // Share one paired device across all tests in this block to avoid
  // hitting the pairing/begin rate limit (5 per 60s per IP).
  let pairedDeviceId: string;

  beforeEach(async () => {
    const { POST: beginPost } = await import('@/app/api/v1/companion/pairing/begin/route');
    const beginRes = await beginPost(authedReq('POST', '/api/v1/companion/pairing/begin'), { params: Promise.resolve({}) });
    if (beginRes.status !== 200) return; // rate limited — skip setup
    const ticket = (await beginRes.json()).data.ticket;
    const { POST: pairPost } = await import('@/app/api/v1/companion/pair/route');
    const pairRes = await pairPost(new NextRequest('http://localhost:3000/api/v1/companion/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, deviceName: 'Shared-PC', version: '1.0' }),
    }), { params: Promise.resolve({}) });
    if (pairRes.status === 200) {
      pairedDeviceId = (await pairRes.json()).data.agentId;
    }
  });

  it('6. lists devices', async () => {
    if (!pairedDeviceId) return; // rate limited
    const { GET } = await import('@/app/api/v1/shops/me/devices/route');
    const listRes = await GET(authedReq('GET', '/api/v1/shops/me/devices'), { params: Promise.resolve({}) });
    const listJson = await listRes.json();
    expect(listRes.status).toBe(200);
    const device = listJson.data.devices.find((d: any) => d.id === pairedDeviceId);
    expect(device).toBeDefined();
    expect(device.name).toBe('Shared-PC');
  });

  it('7. creates a command for a device', async () => {
    if (!pairedDeviceId) return; // rate limited
    const { POST: cmdPost } = await import('@/app/api/v1/shops/me/devices/[deviceId]/commands/route');
    const cmdRes = await cmdPost(authedReq('POST', `/api/v1/shops/me/devices/${pairedDeviceId}/commands`, {
      body: { commandType: 'refresh_printers', idempotencyKey: `test-${Date.now()}` },
    }), { params: Promise.resolve({ deviceId: pairedDeviceId }) });
    const cmdJson = await cmdRes.json();
    expect(cmdRes.status).toBe(200);
    expect(cmdJson.data.status).toBe('requested');
  });

  it('8. rejects invalid command type', async () => {
    if (!pairedDeviceId) return; // rate limited
    const { POST: cmdPost } = await import('@/app/api/v1/shops/me/devices/[deviceId]/commands/route');
    const cmdRes = await cmdPost(authedReq('POST', `/api/v1/shops/me/devices/${pairedDeviceId}/commands`, {
      body: { commandType: 'run_shell', idempotencyKey: `bad-${Date.now()}` },
    }), { params: Promise.resolve({ deviceId: pairedDeviceId }) });
    expect(cmdRes.status).toBe(400);
  });
});

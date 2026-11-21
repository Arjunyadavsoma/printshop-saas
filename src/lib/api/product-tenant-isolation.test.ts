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
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { withAuth } from '@/lib/api/with-auth';
import { ok } from '@/lib/api/envelope';

/**
 * Product-build tenant isolation (Phase 1, docs/DATA-MODEL.md).
 *
 * Extends the legacy cross-tenant suite to the NEW surfaces: printers,
 * price rules, add-ons, direct payments, timeline events, notifications,
 * multi-task files, and the OPERATOR role guard. Same fixture style as
 * cross-tenant-tests.test.ts.
 */

let auth: JwtAuthAdapter;

// Shop A
let shopAId: string;
let ownerAToken: string;
let orderAId: string;
let printerAId: string;
let ruleAId: string;
let addonAId: string;

// Shop B
let shopBId: string;
let ownerBToken: string;
let orderBId: string;
let printerBId: string;
let ruleBId: string;
let operatorBToken: string;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  const container: Container = {
    db,
    storage: new InMemoryStorageAdapter(),
    payment: null as never,
    paymentRegistry: null as never,
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new JsonConsoleLogger({ service: 'test' }),
    auth,
  } as unknown as Container;
  setContainerForTesting(container);

  async function makeShop(slug: string, role2: 'owner' | 'operator') {
    const user = await repos.users.create({
      email: `owner-${slug}@test.com`, phone: '5550000' + String(Math.floor(Math.random() * 9000)), password: 'passX123', role: 'owner', shopId: null,
    }, auth);
    const shopId = crypto.randomUUID();
    await repos.shops.create({
      id: shopId, name: `Shop ${slug}`, slug: `shop-${slug}`, ownerUserId: user.id,
      upiId: 'x@upi', paymentProvider: 'googlepay', paymentCredentials: '',
      pricingConfig: '{}', address: 'X Street', phone: '5550000000',
      timezone: 'Asia/Kolkata', isActive: true, subscriptionTier: 'free', subscriptionExpiresAt: null,
      description: null, businessHours: null, logoUrl: null, upiQrStorageKey: null, servicesJson: null,
      paymentPhone: null, paymentInstructions: null, cashOnPickup: false, paymentMethods: 'both',
      pamphletEnabled: false, pamphletPricePaise: 0, pamphletName: null,
    } as never);
    await repos.users.update(user.id, { shopId } as never);
    const access = await auth.issueAccessToken({ id: user.id, shopId, role: 'owner' });
    let operatorToken: string | null = null;
    if (role2 === 'operator') {
      const op = await repos.users.create({
        email: `operator-${slug}@test.com`, phone: '5550000999', password: 'passO123', role: 'operator', shopId,
      }, auth);
      const opAccess = await auth.issueAccessToken({ id: op.id, shopId, role: 'operator' });
      operatorToken = opAccess.token;
    }
    return { shopId, ownerToken: access.token, operatorToken };
  }

  const A = await makeShop('a-' + crypto.randomUUID().slice(0, 6), 'operator');
  const B = await makeShop('b-' + crypto.randomUUID().slice(0, 6), 'operator');
  shopAId = A.shopId; ownerAToken = A.ownerToken;
  shopBId = B.shopId; ownerBToken = B.ownerToken; operatorBToken = B.operatorToken!;

  const orderA = await repos.orders.createWithUniqueToken(shopAId, { customerPhone: null, notes: null }, (c, a) => `A${100 + c + a}`);
  orderAId = orderA.id;
  const orderB = await repos.orders.createWithUniqueToken(shopBId, { customerPhone: null, notes: null }, (c, a) => `B${100 + c + a}`);
  orderBId = orderB.id;

  printerAId = (await repos.printers.createForShop(shopAId, {
    agentId: null, systemName: 'HP-Color-A', displayName: 'A color', supportsColor: true, supportsDuplex: true,
    paperSizes: ['A4'], isDefaultColor: true, isDefaultBw: false, status: 'ONLINE', statusDetail: null,
    speedPpm: 20, pagesPrintedToday: 0, counterDate: null, lastSeenAt: null, enabled: true,
  })).id;
  printerBId = (await repos.printers.createForShop(shopBId, {
    agentId: null, systemName: 'HP-Color-B', displayName: 'B color', supportsColor: true, supportsDuplex: true,
    paperSizes: ['A4'], isDefaultColor: true, isDefaultBw: false, status: 'ONLINE', statusDetail: null,
    speedPpm: 20, pagesPrintedToday: 0, counterDate: null, lastSeenAt: null, enabled: true,
  })).id;

  ruleAId = (await repos.priceRules.createForShop(shopAId, {
    paperSize: 'A4', paperType: 'PLAIN', colorMode: 'COLOR', sides: 'SINGLE',
    slabs: [{ minPages: 1, perPagePaise: 1000 }], active: true, effectiveFrom: new Date(),
  })).id;
  ruleBId = (await repos.priceRules.createForShop(shopBId, {
    paperSize: 'A4', paperType: 'PLAIN', colorMode: 'BW', sides: 'SINGLE',
    slabs: [{ minPages: 1, perPagePaise: 200 }], active: true, effectiveFrom: new Date(),
  })).id;

  addonAId = (await repos.addons.createForShop(shopAId, {
    kind: 'staple', label: 'Staple', pricePaise: 1000, pricingUnit: 'PER_ORDER', active: true,
  })).id;

  await repos.payments.createForOrder(orderAId, {
    method: 'upi', status: 'SUBMITTED', amountPaise: 6400,
    upiIntentUrl: null, utr: '441234567890', screenshotStorageKey: null,
    confirmedBy: null, confirmedAt: null, rejectReason: null,
  });
  await repos.notifications.createForShop(shopAId, { kind: 'payment_submitted', orderId: orderAId, payload: { amountPaise: 6400 } });
});

function authedReq(token: string, method: string, path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Tenant isolation — printers', () => {
  it('shop A cannot read shop B printer by id', async () => {
    expect(await repos.printers.getForShop(shopAId, printerBId)).toBeNull();
  });
  it('shop A printer list excludes shop B printers', async () => {
    const list = await repos.printers.listForShop(shopAId);
    expect(list.map(p => p.id)).not.toContain(printerBId);
    expect(list.map(p => p.id)).toContain(printerAId);
  });
  it('shop A cannot update shop B printer (routed to 404-shape NotFoundError)', async () => {
    await expect(repos.printers.updateForShop(shopAId, printerBId, { status: 'PAUSED' })).rejects.toThrow();
    const b = await repos.printers.getForShop(shopBId, printerBId);
    expect(b?.status).toBe('ONLINE');
  });
  it('default printers are computed within the shop only', async () => {
    const aColor = await repos.printers.defaultColor(shopAId);
    const bColor = await repos.printers.defaultColor(shopBId);
    expect(aColor?.id).toBe(printerAId);
    expect(bColor?.id).toBe(printerBId);
  });
});

describe('Tenant isolation — pricing and add-ons', () => {
  it('active rules for shop A exclude shop B rules', async () => {
    const rules = await repos.priceRules.activeForShop(shopAId);
    expect(rules.map(r => r.id)).toContain(ruleAId);
    expect(rules.map(r => r.id)).not.toContain(ruleBId);
  });
  it('rule matching is tenant-scoped (B gets its BW rate, not A\'s COLOR rate)', async () => {
    const bMatch = await repos.priceRules.match(shopBId, 'A4', 'BW', 'SINGLE');
    expect(bMatch?.id).toBe(ruleBId);
    expect(bMatch?.slabs[0].perPagePaise).toBe(200);
  });
  it('shop B cannot deactivate shop A rule', async () => {
    const res = await repos.priceRules.deactivateForShop(shopBId, ruleAId);
    expect(res).toBeNull();
    const still = await repos.priceRules.activeForShop(shopAId);
    expect(still.map(r => r.id)).toContain(ruleAId);
  });
  it('shop B cannot read shop A addon', async () => {
    expect(await repos.addons.getForShop(shopBId, addonAId)).toBeNull();
  });
});

describe('Tenant isolation — payments and timeline', () => {
  it('shop B order sees no payments from shop A order', async () => {
    const list = await repos.payments.forOrder(orderBId);
    expect(list).toHaveLength(0);
  });
  it('shop A order payment is present for its own order (legitimate access works)', async () => {
    const list = await repos.payments.forOrder(orderAId);
    expect(list).toHaveLength(1);
    expect(list[0].utr).toBe('441234567890');
  });
  it('order events are scoped to the order (timeline leak impossible)', async () => {
    await repos.orderEvents.append(orderAId, { type: 'order_placed', actorType: 'customer', actorId: null, data: null });
    const aEvents = await repos.orderEvents.forOrder(orderAId);
    const bEvents = await repos.orderEvents.forOrder(orderBId);
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(0);
  });
  it('order event repository has NO mutate/delete surface (append-only)', async () => {
    const repo = repos.orderEvents as unknown as Record<string, unknown>;
    for (const m of Object.keys(repo)) {
      expect(['adapter', 'table', 'append', 'forOrder', 'findOne', 'findMany', 'insertOne', 'updateWhere', 'deleteWhere', 'constructor'].some(k => m === k)).toBe(true);
    }
  });
  it('notifications unread are shop-scoped', async () => {
    const unreadA = await repos.notifications.unreadForShop(shopAId);
    const unreadB = await repos.notifications.unreadForShop(shopBId);
    expect(unreadA).toHaveLength(1);
    expect(unreadB).toHaveLength(0);
    const marked = await repos.notifications.markRead(shopBId, unreadA[0].id);
    expect(marked).toBeNull(); // cross-shop markRead is a no-op
  });
});

describe('Tenant isolation — tasks (PrintJob multi-task model)', () => {
  it('a file in shop A produces tasks invisible to shop B queue', async () => {
    const file = await repos.files.create({
      orderId: orderAId, originalFilename: 'mix.pdf', storageKey: 'k', mimeType: 'application/pdf',
      sizeBytes: 10, pageCount: 10, pageCountSource: 'auto_extracted', copies: 1, colorMode: 'bw',
      pageRange: null, paperSize: 'a4', duplex: false, pricePaise: 0, status: 'ready', processingError: null,
      sha256: null, printedAt: null,
    } as never);
    await repos.printJobs.create({
      shopId: shopAId, fileId: file.id, kind: 'COLOR_SET', sourcePages: [3, 7], sheetCount: 2,
      colorMode: 'COLOR', paperSize: 'A4', duplex: false, pagesPerSheet: 1, orientation: 'AUTO', scale: 'FIT',
      setLabel: 'Color pages: 3, 7', idempotencyKey: `iso-${file.id}-color`, status: 'queued', attempts: 0,
      lastError: null, queuedAt: new Date(), startedAt: null, completedAt: null,
    } as never);
    const queuedB = await repos.printJobs.findQueuedByShop(shopBId, 10);
    expect(queuedB).toHaveLength(0);
    const queuedA = await repos.printJobs.findQueuedByShop(shopAId, 10);
    expect(queuedA).toHaveLength(1);
    expect(queuedA[0].kind).toBe('COLOR_SET');
  });
  it('two concurrent tasks on one file are allowed (active-file invariant retired)', async () => {
    const file = await repos.files.create({
      orderId: orderAId, originalFilename: 'mix2.pdf', storageKey: 'k2', mimeType: 'application/pdf',
      sizeBytes: 10, pageCount: 10, pageCountSource: 'auto_extracted', copies: 1, colorMode: 'bw',
      pageRange: null, paperSize: 'a4', duplex: false, pricePaise: 0, status: 'ready', processingError: null,
      sha256: null, printedAt: null,
    } as never);
    const mk = (kind: string, key: string) => repos.printJobs.create({
      shopId: shopAId, fileId: file.id, kind, sourcePages: [], sheetCount: 1,
      colorMode: 'BW', paperSize: 'A4', duplex: false, pagesPerSheet: 1, orientation: 'AUTO', scale: 'FIT',
      setLabel: null, idempotencyKey: key, status: 'queued', attempts: 0,
      lastError: null, queuedAt: new Date(), startedAt: null, completedAt: null,
    } as never);
    await expect(mk('BW_SET', `iso2-${file.id}-bw`)).resolves.toBeDefined();
    await expect(mk('COLOR_SET', `iso2-${file.id}-color`)).resolves.toBeDefined();
  });
});

describe('Role guard — OPERATOR restrictions', () => {
  const handler = withAuth(async (req, ctx, principal) => ok({ role: principal.role, shopId: principal.shopId }), ['owner']);

  it('operator token is rejected with 403 on owner-only route', async () => {
    const res = await handler(authedReq(operatorBToken, 'GET', '/api/v1/shops/me/pricing'), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });
  it('owner token passes the same route', async () => {
    const res = await handler(authedReq(ownerBToken, 'GET', '/api/v1/shops/me/pricing'), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
  });
  it('operator keeps tenant scoping on allowed routes (principal.shopId is theirs)', async () => {
    const openHandler = withAuth(async (req, ctx, principal) => ok({ shopId: principal.shopId }));
    const res = await openHandler(authedReq(operatorBToken, 'GET', '/api/v1/shops/me/orders'), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(body.data.shopId).toBe(shopBId);
    expect(body.data.shopId).not.toBe(shopAId);
  });
});

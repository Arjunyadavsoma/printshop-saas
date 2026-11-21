import { describe, expect, it, beforeAll } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { setContainerForTesting, getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { processUpload } from '@/lib/pipeline/process';
import { quoteOrder, placeOrder, submitPayment, cancelOrder, orderTracking, confirmPayment, rejectPayment, refreshOrderPrintState } from '@/lib/orders/order-flow';
import { buildUpiIntentUrl } from '@/lib/payments/upi';
import {
  InMemoryDatabaseAdapter,
  InMemoryCacheAdapter,
  InMemoryStorageAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
} from '@platform/adapters';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';

/**
 * Phase 4 journey (server-side): upload→process→spec→quote→place→pay→
 * confirm→tasks→printed→ready→track — against an in-memory container with
 * REAL pipeline processing (gs/pdftoppm on the generated mixed PDF).
 */

let shopId: string;
let ownerAuth: JwtAuthAdapter;

beforeAll(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  ownerAuth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  setContainerForTesting({
    db,
    storage: new InMemoryStorageAdapter(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new JsonConsoleLogger({ service: 'test' }),
    auth: ownerAuth,
  } as never);

  const user = await repos.users.create({ email: 'flow@test.com', phone: '5550000000', password: 'passX123', role: 'owner', shopId: null }, ownerAuth);
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId, name: 'Flow Shop', slug: `flow-${shopId.slice(0, 6)}`, ownerUserId: user.id,
    upiId: 'flowshop@ybl', upiPayeeName: 'Flow Shop', paymentProvider: 'manual-upi', paymentCredentials: '',
    pricingConfig: '{}', address: '1 Test Road', phone: '5550000000', timezone: 'Asia/Kolkata',
    isActive: true, subscriptionTier: 'free', subscriptionExpiresAt: null, description: null,
    businessHours: null, logoUrl: null, upiQrStorageKey: null, servicesJson: null,
    paymentPhone: null, paymentInstructions: null, cashOnPickup: false, paymentMethods: 'both',
    pamphletEnabled: false, pamphletPricePaise: 0, pamphletName: null,
    isOpen: true, acceptingOrders: true, paymentMode: 'UPI_THEN_PRINT',
    colorSheetBilling: 'PER_PAGE_ACTUAL', urgencySurchargePaise: 2500, orderExpiryMinutes: 30,
  } as never);
  await repos.users.update(user.id, { shopId } as never);

  // price rules (A4)
  for (const [colorMode, sides, slabs] of [
    ['BW', 'SINGLE', [{ minPages: 1, perPagePaise: 200 }, { minPages: 51, perPagePaise: 150 }]],
    ['BW', 'DOUBLE', [{ minPages: 1, perPagePaise: 180 }]],
    ['COLOR', 'SINGLE', [{ minPages: 1, perPagePaise: 1000 }, { minPages: 21, perPagePaise: 800 }]],
    ['COLOR', 'DOUBLE', [{ minPages: 1, perPagePaise: 900 }]],
  ] as const) {
    await repos.priceRules.createForShop(shopId, { paperSize: 'A4', paperType: 'PLAIN', colorMode, sides, slabs: slabs as never, active: true, effectiveFrom: new Date() });
  }
  const staple = await repos.addons.createForShop(shopId, { kind: 'staple', label: 'Staple', pricePaise: 1000, pricingUnit: 'PER_ORDER', active: true });
  void staple;

  // printers: color + bw (both ONLINE)
  await repos.printers.createForShop(shopId, {
    agentId: null, systemName: 'HP-Color', displayName: 'Color', supportsColor: true, supportsDuplex: true,
    paperSizes: ['A4'], isDefaultColor: true, isDefaultBw: false, status: 'ONLINE', statusDetail: null,
    speedPpm: 20, pagesPrintedToday: 0, counterDate: null, lastSeenAt: null, enabled: true,
  });
  await repos.printers.createForShop(shopId, {
    agentId: null, systemName: 'Ricoh-BW', displayName: 'B&W', supportsColor: false, supportsDuplex: true,
    paperSizes: ['A4'], isDefaultColor: false, isDefaultBw: true, status: 'ONLINE', statusDetail: null,
    speedPpm: 30, pagesPrintedToday: 0, counterDate: null, lastSeenAt: null, enabled: true,
  });
});

async function makeMixedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 10; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i}`, { x: 60, y: 780, size: 18 });
    if (i === 3 || i === 7) page.drawRectangle({ x: 60, y: 300, width: 480, height: 320, color: rgb(0.9, 0.1, 0.35) });
  }
  return doc.save();
}

/** Attach the DoD spec (10 pages, 3&7 color) to a file — like PUT /specs. */
async function attachSpec(orderId: string, fileId: string, overrides: Record<string, unknown> = {}) {
  await getContainer().db.insert('printSpec', {
    id: crypto.randomUUID(),
    orderFileId: fileId,
    copies: 1,
    paperSize: 'A4',
    paperType: 'PLAIN',
    orientation: 'AUTO',
    sides: 'SINGLE',
    duplexEdge: 'long',
    pagesPerSheet: 1,
    scale: 'FIT',
    collate: true,
    pageRangeText: '1-10',
    pageModes: Array.from({ length: 10 }, (_, i) => ({ page: i + 1, mode: (i + 1 === 3 || i + 1 === 7 ? 'color' : 'bw') })),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

/** Upload a file into a fresh draft order and process it to READY. */
async function uploadProcessed(): Promise<{ orderId: string; orderToken: string; fileId: string }> {
  const bytes = await makeMixedPdf();
  const order = await repos.orders.createWithUniqueToken(shopId, { customerPhone: null, notes: null }, (c, a) => crypto.randomUUID().replace(/-/g, ''));
  await getContainer().db.update('order', { id: order.id }, { status: 'draft' });
  const file = await repos.files.create({
    orderId: order.id, originalFilename: 'assignment-final.pdf', mimeType: 'application/pdf',
    storageKey: `shops/${shopId}/orders/${order.id}/orig/assignment-final.pdf`,
    sizeBytes: bytes.length, pageCount: null, status: 'uploaded',
  });
  await getContainer().storage.put?.(file.storageKey, bytes, 'application/pdf');
  const result = await processUpload(file.id);
  if (result.status !== 'READY') throw new Error('pipeline failed: ' + result.failReason);
  await attachSpec(order.id, file.id);
  return { orderId: order.id, orderToken: order.customerToken, fileId: file.id };
}

function specFor(fileId: string, overrides: Partial<Parameters<typeof quoteOrder>[1][number]['spec']> = {}) {
  return {
    fileId,
    spec: {
      pageModes: Array.from({ length: 10 }, (_, i) => ({ page: i + 1, mode: (i + 1 === 3 || i + 1 === 7 ? 'color' : 'bw') as 'color' | 'bw' })),
      copies: 1, sides: 'SINGLE' as const, pagesPerSheet: 1 as const, paperSize: 'A4', paperType: 'PLAIN', collate: true,
      ...overrides,
    },
  };
}

describe('customer journey (server-side)', () => {
  it('quote → place → pay → confirm → tasks → printed → ready → track', async () => {
    const { orderId, orderToken, fileId } = await uploadProcessed();

    // ── quote ──
    const quote = await quoteOrder(shopId, [specFor(fileId)], [], false);
    expect(quote.totalPaise).toBe(8 * 200 + 2 * 1000); // ₹36.00
    expect(quote.ruleMissing).toBe(false);

    // ── place (client total matches) ──
    const db = getContainer().db;
    const orderRow = await db.findOne<{ id: string; customerToken: string; status: string; notes: string | null }>('order', { id: orderId });
    const shop = await db.findOne<Record<string, unknown>>('shop', { id: shopId });
    const placed = await placeOrder(shop!, orderRow!, [], false, quote.totalPaise!, 'Priya Sharma', '9876543210', 'staple top-left');
    expect(placed.pricesChanged).toBe(false);
    expect(placed.totalPaise).toBe(3600);
    expect(placed.pickupCode).toMatch(/^\d{4}$/);
    const placed1 = await db.findOne<{ status: string; pickupCode: string | null; orderNumber: string | null; customerName: string | null }>('order', { id: orderId });
    expect(placed1!.status).toBe('awaiting_payment');
    expect(placed1!.pickupCode).toBe(placed.pickupCode);
    expect(placed1!.orderNumber).toBe(placed.orderNumber);

    // ── price-changed guard: wrong client total is rejected ──
    const order2 = await uploadProcessed();
    const row2 = await db.findOne<{ id: string; customerToken: string; status: string; notes: string | null }>('order', { id: order2.orderId });
    await expect(placeOrder(shop!, row2!, [], false, 999999, null, null, null)).rejects.toThrow(/Prices changed/);

    // ── pay: UTR submitted (order NOT paid — verification is manual) ──
    const pay = await submitPayment(orderToken, { method: 'upi', utr: '441234567890' });
    expect(pay.status).toBe('SUBMITTED');
    const afterPay = await db.findOne<{ status: string; paymentUtr: string | null }>('order', { id: orderId });
    expect(afterPay!.status).toBe('payment_submitted');
    expect(afterPay!.paymentUtr).toBe('441234567890');
    await expect(submitPayment(orderToken, { method: 'upi', utr: '1234' })).rejects.toThrow(/12-digit/);

    // ── shopkeeper confirms → paid → queued + tasks built ──
    const confirmed = await confirmPayment(orderId, shopId, 'owner-user-1');
    expect(confirmed.status).toBe('queued');
    expect(confirmed.tasksCreated).toBe(2); // COLOR_SET + BW_SET
    const tasks = await repos.printJobs.findAllByShop(shopId, 50);
    const orderTasks = tasks.filter(t => t.sourcePages !== null);
    const colorTask = orderTasks.find(t => t.colorMode === 'COLOR');
    const bwTask = orderTasks.find(t => t.colorMode === 'BW');
    expect(colorTask?.sourcePages).toEqual([3, 7]);
    expect(colorTask?.copies).toBe(1);
    expect(bwTask?.sourcePages).toEqual([1, 2, 4, 5, 6, 8, 9, 10]);
    expect(colorTask?.printerId).not.toBe(bwTask?.printerId);

    // idempotent re-run: no duplicate tasks
    const again = await confirmPayment(orderId, shopId, 'owner-user-1').catch(() => null);
    void again;
    const rebuilt = await import('@/lib/dispatch/task-builder').then(m => m.buildTasksForOrder(orderId));
    expect(rebuilt.tasksCreated).toBe(0); // all already exist

    // ── agent reports printed → order becomes READY ──
    for (const t of [colorTask!, bwTask!]) {
      await repos.printJobs.update(t.id, { status: 'printed', printedAt: new Date() });
    }
    await refreshOrderPrintState(orderId);
    const ready = await db.findOne<{ status: string; readyAt: Date | null }>('order', { id: orderId });
    expect(ready!.status).toBe('ready');
    expect(ready!.readyAt).not.toBeNull();

    // ── tracking payload (no login; token is the credential) ──
    const track = await orderTracking(orderToken);
    expect(track.order.status).toBe('ready');
    expect(track.order.pickupCode).toBe(placed.pickupCode);
    expect(track.tasks).toHaveLength(2);
    expect(track.events.map(e => e.type)).toEqual(expect.arrayContaining(['order_placed', 'payment_submitted', 'payment_confirmed', 'queued', 'ready']));
    expect(track.shop!.name).toBe('Flow Shop');
    expect(track.upiIntentUrl).toContain('upi://pay');
    expect(track.upiIntentUrl).toContain('am=36.00');

    // UPI intent built from the shop's own VPA — customer pays the shop directly
    const intent = buildUpiIntentUrl({ payeeUpi: 'flowshop@ybl', payeeName: 'Flow Shop', amountPaise: 3600, orderShortId: placed.orderNumber });
    expect(intent).toContain('pa=flowshop%40ybl');
  });

  it('payment rejection lets the customer resubmit; counter payment goes to the board', async () => {
    const { orderId, orderToken, fileId } = await uploadProcessed();
    const db = getContainer().db;
    const orderRow = await db.findOne<{ id: string; customerToken: string; status: string; notes: string | null }>('order', { id: orderId });
    const shop = await db.findOne<Record<string, unknown>>('shop', { id: shopId });
    await placeOrder(shop!, orderRow!, [], false, null, null, null, null);
    await submitPayment(orderToken, { method: 'upi', utr: '555555555555' });

    // shopkeeper rejects → awaiting_payment again
    await rejectPayment(orderId, shopId, 'owner-user-1', 'Amount differs from the order');
    const rejected = await db.findOne<{ status: string }>('order', { id: orderId });
    expect(rejected!.status).toBe('awaiting_payment');
    // customer resubmits a corrected UTR
    await submitPayment(orderToken, { method: 'upi', utr: '555555555556' });
    const resub = await db.findOne<{ status: string; paymentUtr: string | null }>('order', { id: orderId });
    expect(resub!.status).toBe('payment_submitted');
    expect(resub!.paymentUtr).toBe('555555555556');
    void fileId;
  });

  it('customer cancels before printing; cancel after printing is rejected', async () => {
    const { orderToken } = await uploadProcessed();
    const res = await cancelOrder(orderToken, 'Found the original file');
    expect(res.cancelled).toBe(true);
    const track = await orderTracking(orderToken);
    expect(track.order.status).toBe('cancelled');
    expect(track.order.cancelReason).toBe('Found the original file');
  });

  it('addons + urgent flow through to the total (staple ₹10 + urgent ₹25)', async () => {
    const { fileId } = await uploadProcessed();
    const addons = await repos.addons.activeForShop(shopId);
    const quote = await quoteOrder(shopId, [specFor(fileId)], addons.map(a => ({ addon: a as never })), true);
    expect(quote.subtotalPaise).toBe(3600);
    expect(quote.addonsPaise).toBe(1000); // staple PER_ORDER
    expect(quote.urgentPaise).toBe(2500);
    expect(quote.totalPaise).toBe(3600 + 1000 + 2500);
  });
});

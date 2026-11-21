/**
 * PrintShop product seed — Phase 1 (docs/DATA-MODEL.md).
 *
 * Creates two shops with owner+operator staff, three printers each
 * (color-capable / BW-only / paused-with-error), per-size price rules with
 * slabs, add-ons, and 15 sample orders per shop spread across the full
 * status machine (with files + specs + tasks + events + payments for the
 * later-stage orders so the board and detail pages are populated).
 *
 * Idempotent: re-running deletes the seed shops' data first.
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const db = new PrismaClient();

const ITER = 600_000;
function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(plain, salt, ITER, 32, 'sha256');
  return `pbkdf2$${ITER}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

// deterministic-ish tokens per run are fine (seed data), but keep them unique
const tok = () => randomBytes(8).toString('hex');
const pickup = () => String(Math.floor(Math.random() * 9000) + 1000);

const PRICE_RULES: Array<{
  paperSize: string; colorMode: string; sides: string;
  slabs: Array<{ minPages: number; perPagePaise: number }>;
}> = [
  { paperSize: 'A4', colorMode: 'BW', sides: 'SINGLE', slabs: [{ minPages: 1, perPagePaise: 200 }, { minPages: 51, perPagePaise: 150 }] },
  { paperSize: 'A4', colorMode: 'BW', sides: 'DOUBLE', slabs: [{ minPages: 1, perPagePaise: 180 }, { minPages: 51, perPagePaise: 130 }] },
  { paperSize: 'A4', colorMode: 'COLOR', sides: 'SINGLE', slabs: [{ minPages: 1, perPagePaise: 1000 }, { minPages: 21, perPagePaise: 800 }] },
  { paperSize: 'A4', colorMode: 'COLOR', sides: 'DOUBLE', slabs: [{ minPages: 1, perPagePaise: 900 }, { minPages: 21, perPagePaise: 750 }] },
  { paperSize: 'A3', colorMode: 'BW', sides: 'SINGLE', slabs: [{ minPages: 1, perPagePaise: 400 }] },
  { paperSize: 'A3', colorMode: 'COLOR', sides: 'SINGLE', slabs: [{ minPages: 1, perPagePaise: 1500 }] },
  { paperSize: 'Letter', colorMode: 'BW', sides: 'SINGLE', slabs: [{ minPages: 1, perPagePaise: 220 }] },
  { paperSize: 'Letter', colorMode: 'COLOR', sides: 'SINGLE', slabs: [{ minPages: 1, perPagePaise: 1100 }] },
];

const ADDONS = [
  { kind: 'staple', label: 'Staple', pricePaise: 1000, pricingUnit: 'PER_ORDER' },
  { kind: 'spiral_bind', label: 'Spiral binding', pricePaise: 3000, pricingUnit: 'PER_COPY' },
  { kind: 'laminate', label: 'Laminate', pricePaise: 2000, pricingUnit: 'PER_SHEET' },
  { kind: 'home_delivery_note', label: 'Home delivery note', pricePaise: 5000, pricingUnit: 'PER_ORDER' },
];

/** 10-page doc: pages 3 and 7 color — the Definition-of-Done example. */
function mixedPageModes(): Array<{ page: number; mode: string }> {
  return Array.from({ length: 10 }, (_, i) => ({
    page: i + 1,
    mode: i + 1 === 3 || i + 1 === 7 ? 'color' : 'bw',
  }));
}

async function seedShop(opts: {
  slug: string; name: string; address: string; upiId: string; payee: string;
  paymentMode: string; open: boolean; accepting: boolean;
}) {
  const shop = await db.shop.create({
    data: {
      id: randomUUID(),
      name: opts.name,
      slug: opts.slug,
      ownerUserId: 'seed',
      upiId: opts.upiId,
      upiPayeeName: opts.payee,
      paymentProvider: 'manual-upi',
      paymentCredentials: '{}',
      pricingConfig: '{}',
      address: opts.address,
      phone: '900000000' + (opts.slug === 'sai-xerox' ? '1' : '2'),
      isOpen: opts.open,
      acceptingOrders: opts.accepting,
      openingHours: { mon: ['09:00', '21:00'], tue: ['09:00', '21:00'], wed: ['09:00', '21:00'], thu: ['09:00', '21:00'], fri: ['09:00', '21:00'], sat: ['10:00', '18:00'], sun: null },
      languages: ['en', 'hi'],
      retentionHours: 24,
      paymentMode: opts.paymentMode,
      autoConfirmCounterPayment: false,
      colorSheetBilling: 'PER_PAGE_ACTUAL',
      orderExpiryMinutes: 30,
      urgencySurchargePaise: 2500,
      description: opts.slug === 'sai-xerox' ? 'Opposite City College — thesis and xerox specialist' : 'Court-road digital prints, binding and lamination',
    },
  });

  await db.user.createMany({
    data: [
      { id: randomUUID(), email: `owner@${opts.slug}.test`, phone: '9876500001', passwordHash: hashPassword('Shop@123'), role: 'owner', name: `${opts.name} Owner`, shopId: shop.id },
      { id: randomUUID(), email: `operator@${opts.slug}.test`, phone: '9876500002', passwordHash: hashPassword('Shop@123'), role: 'operator', name: `${opts.name} Counter`, shopId: shop.id },
    ],
  });

  const colorP = await db.printer.create({
    data: {
      id: randomUUID(), shopId: shop.id, systemName: 'HP Color LaserJet M455', displayName: 'Color — counter top',
      supportsColor: true, supportsDuplex: true, paperSizes: ['A4', 'A3', 'Letter'], isDefaultColor: true,
      status: 'ONLINE', speedPpm: 22, pagesPrintedToday: 120, counterDate: new Date(),
    },
  });
  const bwP = await db.printer.create({
    data: {
      id: randomUUID(), shopId: shop.id, systemName: 'Ricoh IM 2702', displayName: 'B&W — back table',
      supportsColor: false, supportsDuplex: true, paperSizes: ['A4', 'A5', 'Letter'], isDefaultBw: true,
      status: 'ONLINE', speedPpm: 30, pagesPrintedToday: 480, counterDate: new Date(),
    },
  });
  await db.printer.create({
    data: {
      id: randomUUID(), shopId: shop.id, systemName: 'Canon iR2625', displayName: 'Old Canon (upstairs)',
      supportsColor: false, supportsDuplex: false, paperSizes: ['A4'], enabled: false,
      status: 'ERROR', statusDetail: 'Paper jam in tray 2', speedPpm: 25, pagesPrintedToday: 60, counterDate: new Date(),
    },
  });

  for (const r of PRICE_RULES) {
    await db.priceRule.create({
      data: { id: randomUUID(), shopId: shop.id, paperSize: r.paperSize, colorMode: r.colorMode, sides: r.sides, slabs: r.slabs, active: true },
    });
  }
  for (const a of ADDONS) {
    await db.addon.create({ data: { id: randomUUID(), shopId: shop.id, ...a, active: true } });
  }

  // 15 orders across the status machine
  const statuses = [
    'awaiting_payment', 'awaiting_payment', 'awaiting_payment',
    'payment_submitted', 'payment_submitted',
    'paid', 'paid',
    'queued', 'queued',
    'printing', 'printing',
    'partially_printed',
    'ready',
    'collected',
    'cancelled',
  ] as const;

  const names = ['Priya Sharma', 'Ravi Kumar', 'Amit Mehta', 'Sneha Desai', 'Arjun Rao', 'Kavya Reddy', 'Vikram Singh', 'Neha Gupta', 'Farhan Ali', 'Divya Nair', 'Rohit Verma', 'Ananya Iyer', 'Sameer Joshi', 'Lakshmi Prasad', 'Manish Tiwari'];

  let n = 0;
  for (const status of statuses) {
    n += 1;
    const customer = pick(names, n);
    const placedAt = new Date(Date.now() - (16 - n) * 37 * 60 * 1000);
    const order = await db.order.create({
      data: {
        id: randomUUID(),
        shopId: shop.id,
        customerToken: tok(),
        tokenNumber: String(100 + n),
        orderNumber: String(4000 + n),
        pickupCode: pickup(),
        status,
        customerName: customer,
        customerPhone: '9' + String(800000000 + n * 1234567).slice(0, 9),
        notes: n % 4 === 0 ? 'Print double-sided, staple top-left please' : null,
        subtotalPaise: 5400, addonsPaise: 1000, totalAmountPaise: 6400,
        priceSnapshot: { note: 'seed', lines: [{ file: 'assignment-final.pdf', bwPages: 8, colorPages: 2, perPageBwPaise: 200, perPageColorPaise: 1000, copies: 1 }] },
        placedAt, paidAt: ['paid', 'queued', 'printing', 'partially_printed', 'ready', 'collected'].includes(status) ? placedAt : null,
        readyAt: ['ready', 'collected'].includes(status) ? new Date(placedAt.getTime() + 11 * 60000) : null,
        collectedAt: status === 'collected' ? new Date(placedAt.getTime() + 40 * 60000) : null,
        cancelledAt: status === 'cancelled' ? new Date(placedAt.getTime() + 5 * 60000) : null,
        cancelReason: status === 'cancelled' ? 'Customer found the original file' : null,
        urgent: n % 7 === 0,
        expiresAt: ['awaiting_payment', 'payment_submitted'].includes(status) ? new Date(placedAt.getTime() + 30 * 60000) : null,
        paymentModeAtOrder: opts.paymentMode,
        createdAt: placedAt,
        updatedAt: placedAt,
      },
    });

    // one file with mixed page modes (the DoD example) on every order
    const file = await db.printFile.create({
      data: {
        id: randomUUID(), orderId: order.id,
        originalFilename: 'assignment-final.pdf', mimeType: 'application/pdf',
        storageKey: `shops/${shop.id}/orders/${order.id}/orig/assignment-final.pdf`,
        pdfStorageKey: `shops/${shop.id}/orders/${order.id}/pdf/assignment-final.pdf`,
        sizeBytes: 240_000, pageCount: 10, pageCountSource: 'auto_extracted',
        pageWidthPt: 595, pageHeightPt: 842,
        colorSuggestion: mixedPageModes().map(m => ({ page: m.page, isColor: m.mode === 'color', confidence: 0.93 })),
        status: 'READY', copies: 1, colorMode: 'mixed', pageRange: '1-10', paperSize: 'A4', duplex: false,
        pricePaise: 5400, checksum: 'seed-' + tok(),
      } as never,
    });

    await db.printSpec.create({
      data: {
        id: randomUUID(), orderFileId: file.id,
        copies: 1, paperSize: 'A4', paperType: 'PLAIN', orientation: 'AUTO',
        sides: 'SINGLE', pagesPerSheet: 1, scale: 'FIT', collate: true,
        pageRangeText: '1-10', pageModes: mixedPageModes(),
      },
    });

    // tasks for orders that have reached the print stages
    if (['queued', 'printing', 'partially_printed', 'ready', 'collected', 'cancelled'].includes(status)) {
      const taskStatus = { queued: 'queued', printing: 'printing', partially_printed: 'printed', ready: 'printed', collected: 'printed', cancelled: 'cancelled' }[status as 'queued']!;
      await db.printJob.create({
        data: {
          id: randomUUID(), shopId: shop.id, fileId: file.id, printerId: bwP.id,
          kind: 'BW_SET', sourcePages: [1, 2, 4, 5, 6, 8, 9, 10], sheetCount: 8,
          colorMode: 'BW', paperSize: 'A4', duplex: false, pagesPerSheet: 1,
          orientation: 'AUTO', scale: 'FIT', setLabel: 'B&W pages: 1-2, 4-6, 8-10',
          idempotencyKey: `seed-${order.id}-bw`, status: taskStatus,
          attempts: 1, queuedAt: placedAt, startedAt: placedAt,
          printedAt: ['partially_printed', 'ready', 'collected'].includes(status) ? new Date(placedAt.getTime() + 9 * 60000) : null,
          completedAt: ['ready', 'collected'].includes(status) ? new Date(placedAt.getTime() + 10 * 60000) : null,
        },
      });
      await db.printJob.create({
        data: {
          id: randomUUID(), shopId: shop.id, fileId: file.id, printerId: colorP.id,
          kind: 'COLOR_SET', sourcePages: [3, 7], sheetCount: 2,
          colorMode: 'COLOR', paperSize: 'A4', duplex: false, pagesPerSheet: 1,
          orientation: 'AUTO', scale: 'FIT', setLabel: 'Color pages: 3, 7',
          idempotencyKey: `seed-${order.id}-color`, status: taskStatus,
          attempts: 1, queuedAt: placedAt, startedAt: placedAt,
          printedAt: ['ready', 'collected'].includes(status) ? new Date(placedAt.getTime() + 10 * 60000) : null,
          completedAt: ['ready', 'collected'].includes(status) ? new Date(placedAt.getTime() + 11 * 60000) : null,
        },
      });
    }

    // payment rows where relevant
    if (['payment_submitted', 'paid', 'queued', 'printing', 'partially_printed', 'ready', 'collected'].includes(status)) {
      await db.payment.create({
        data: {
          id: randomUUID(), orderId: order.id, method: 'upi',
          status: status === 'payment_submitted' ? 'SUBMITTED' : 'CONFIRMED',
          amountPaise: 6400,
          upiIntentUrl: `upi://pay?pa=${opts.upiId}&pn=${encodeURIComponent(opts.payee)}&am=64.00&cu=INR&tn=${order.id.slice(0, 8)}`,
          utr: status === 'payment_submitted' ? '44123456789' + n : '441234567890',
          confirmedBy: status === 'payment_submitted' ? null : 'seed-owner',
          confirmedAt: status === 'payment_submitted' ? null : new Date(placedAt.getTime() + 4 * 60000),
        },
      });
    }

    // timeline events
    const events: Array<[string, string, object?]> = [['order_placed', 'CUSTOMER']];
    if (order.paidAt) events.push(['payment_confirmed', 'SHOP']);
    if (['queued', 'printing', 'partially_printed', 'ready', 'collected'].includes(status)) events.push(['queued', 'SYSTEM']);
    if (['printing', 'partially_printed', 'ready', 'collected'].includes(status)) events.push(['printing_started', 'AGENT']);
    if (['ready', 'collected'].includes(status)) events.push(['ready', 'SHOP']);
    if (status === 'collected') events.push(['collected', 'SHOP']);
    if (status === 'cancelled') events.push(['cancelled', 'CUSTOMER', { reason: 'Customer found the original file' }]);
    for (const [type, actorType, data] of events) {
      await db.orderEvent.create({
        data: { id: randomUUID(), orderId: order.id, type, actorType, actorId: actorType === 'SHOP' ? 'seed-owner' : null, data: data ?? undefined, createdAt: placedAt },
      });
    }
  }

  return shop.id;
}

async function main() {
  console.log('seeding…');
  // idempotent: remove previous seed shops (children first — FKs are RESTRICT)
  for (const slug of ['sai-xerox', 'ganesh-digital']) {
    const s = await db.shop.findUnique({ where: { slug } });
    if (s) {
      await db.orderEvent.deleteMany({ where: { order: { shopId: s.id } } });
      await db.payment.deleteMany({ where: { order: { shopId: s.id } } });
      await db.notification.deleteMany({ where: { shopId: s.id } });
      await db.printJob.deleteMany({ where: { shopId: s.id } });
      await db.printSpec.deleteMany({ where: { orderFile: { order: { shopId: s.id } } } });
      await db.printFile.deleteMany({ where: { order: { shopId: s.id } } });
      await db.printer.deleteMany({ where: { shopId: s.id } });
      await db.priceRule.deleteMany({ where: { shopId: s.id } });
      await db.addon.deleteMany({ where: { shopId: s.id } });
      await db.order.deleteMany({ where: { shopId: s.id } });
      await db.user.deleteMany({ where: { shopId: s.id } });
      await db.shop.delete({ where: { id: s.id } });
    }
  }

  await seedShop({ slug: 'sai-xerox', name: 'Shri Sai Xerox', address: '12-4-5, Court Road, Kothi', upiId: 'saisxerox@ybl', payee: 'Shri Sai Xerox', paymentMode: 'UPI_THEN_PRINT', open: true, accepting: true });
  await seedShop({ slug: 'ganesh-digital', name: 'Ganesh Digital Studio', address: 'Shop 7, Ring Road market', upiId: 'ganeshdigital@okaxis', payee: 'Ganesh Digital', paymentMode: 'BOTH', open: true, accepting: true });

  const counts = {
    shops: await db.shop.count({ where: { slug: { in: ['sai-xerox', 'ganesh-digital'] } } }),
    users: await db.user.count({ where: { email: { endsWith: '.test' } } }),
    printers: await db.printer.count(),
    orders: await db.order.count({ where: { shop: { slug: { in: ['sai-xerox', 'ganesh-digital'] } } } }),
    files: await db.printFile.count(),
    tasks: await db.printJob.count({ where: { idempotencyKey: { startsWith: 'seed-' } } }),
    events: await db.orderEvent.count(),
    payments: await db.payment.count(),
    priceRules: await db.priceRule.count(),
    addons: await db.addon.count(),
  };
  console.log(JSON.stringify(counts, null, 1));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());

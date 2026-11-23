import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { planPrintJob } from '@/lib/printing/planner';
import type { PlannerSpec, PrintPlan, PlannerPrinter } from '@/lib/printing/planner';
import { computeOrderPrice } from '@/lib/pricing/price-engine';
import type { RuleLike, AddonLike } from '@/lib/pricing/price-engine';
import { buildUpiIntentUrl, isValidUtr } from '@/lib/payments/upi';
import { assertOrderTransition } from '@/lib/orders/state-machine';
import { ValidationError, NotFoundError, AppError } from '@platform/core/errors';
import { IllegalTransitionError } from '@/lib/orders/state-machine';

/**
 * Customer order flow (Phase 4) — quote → place → pay → track → cancel.
 * All money math happens HERE (server); the client total is advisory and
 * must match at place time or the response says "prices changed".
 */

export type DraftFileSpec = {
  fileId: string;
  spec: {
    pageModes: Array<{ page: number; mode: 'color' | 'bw' | 'skip' }>;
    copies: number;
    sides: 'SINGLE' | 'DOUBLE';
    pagesPerSheet: 1 | 2 | 4 | 6 | 9;
    paperSize: string;
    paperType: string;
    collate: boolean;
  };
};

async function shopRulesForShop(shopId: string): Promise<{ rules: RuleLike[]; addons: AddonLike[]; shop: Record<string, unknown> }> {
  const db = getContainer().db;
  const shop = await db.findOne<Record<string, unknown>>('shop', { id: shopId });
  if (!shop) throw new NotFoundError('Shop not found');
  const ruleRows = await repos.priceRules.activeForShop(shopId);
  const addonRows = await repos.addons.activeForShop(shopId);
  return {
    rules: ruleRows as unknown as RuleLike[],
    addons: addonRows as unknown as AddonLike[],
    shop,
  };
}

function printersForShop(shopId: string): Promise<PlannerPrinter[]> {
  return repos.printers.listForShop(shopId).then(rows =>
    rows.filter(p => p.enabled).map(p => ({
      id: p.id,
      supportsColor: p.supportsColor,
      supportsDuplex: p.supportsDuplex,
      paperSizes: (p.paperSizes ?? []) as string[],
      isDefaultColor: p.isDefaultColor,
      isDefaultBw: p.isDefaultBw,
      status: p.status,
      enabled: p.enabled,
    })),
  );
}

/** Plan + price ONE file's spec against the shop's rules. */
async function planAndPriceFile(shopId: string, file: DraftFileSpec, colorSheetBilling: 'PER_PAGE_ACTUAL' | 'SHEET_AS_COLOR'): Promise<{ plan: PrintPlan; spec: PlannerSpec }> {
  const { rules } = await shopRulesForShop(shopId);
  const { makeRateFor } = await import('@/lib/pricing/price-engine');
  const printers = await printersForShop(shopId);
  const rateFor = makeRateFor(rules);
  const plan = planPrintJob({
    spec: file.spec as PlannerSpec,
    printers,
    rateFor,
    colorSheetBilling,
  });
  return { plan, spec: file.spec as PlannerSpec };
}

/** Stateless quote — the client shows this; place-time recomputes. */
export async function quoteOrder(shopId: string, files: DraftFileSpec[], addonSelections: Array<{ addon: AddonLike; quantity?: number }>, urgent: boolean): Promise<{
  lines: unknown;
  subtotalPaise: number | null;
  addonsPaise: number;
  addonsDetail: unknown[];
  urgentPaise: number;
  totalPaise: number | null;
  ruleMissing: boolean;
  warnings: string[];
}> {
  const { rules, shop } = await shopRulesForShop(shopId);
  const colorSheetBilling = (shop.colorSheetBilling as string) === 'SHEET_AS_COLOR' ? 'SHEET_AS_COLOR' : 'PER_PAGE_ACTUAL';
  const urgencySurcharge = (shop.urgencySurchargePaise as number) ?? 0;

  const pricings: import('@/lib/pricing/price-engine').PricingBreakdown[] = [];
  const warnings: string[] = [];
  let totalSheets = 0;
  let totalCopies = 0;
  for (const f of files) {
    const { plan } = await planAndPriceFile(shopId, f, colorSheetBilling);
    pricings.push(plan.pricing);
    warnings.push(...plan.warnings);
    totalSheets += plan.tasks.reduce((sum, t) => sum + t.sheetCount * t.copies, 0);
    totalCopies += f.spec.copies;
  }
  const price = computeOrderPrice({
    filePricings: pricings,
    rules,
    addons: addonSelections,
    totalSheets,
    totalCopies,
    urgent,
    urgentSurchargePaise: urgencySurcharge,
  });

  // Fallback pricing: when no price rules exist (ruleMissing), compute a
  // simple estimate from the shop's pricingConfig so the customer flow can
  // proceed end-to-end in dev/demo mode.
  if (price.ruleMissing || price.totalPaise == null) {
    const pricingCfg = typeof shop.pricingConfig === 'string'
      ? (() => { try { return JSON.parse(shop.pricingConfig as string); } catch { return null; } })()
      : shop.pricingConfig;
    const bwPerPage = (pricingCfg as Record<string, number> | null)?.bw_a4_per_page ?? 200;
    const colorPerPage = (pricingCfg as Record<string, number> | null)?.color_a4_per_page ?? 600;
    const minOrder = (pricingCfg as Record<string, number> | null)?.min_order_value ?? 500;
    let fallbackTotal = 0;
    const fallbackLines: Array<{ paperSize: string; colorMode: string; sides: string; paperType: string; pages: number; copies: number; perPagePaise: number; linePaise: number; ruleMissing: boolean }> = [];
    for (const f of files) {
      const colorPages = f.spec.pageModes.filter(p => p.mode === 'color').length;
      const bwPages = f.spec.pageModes.filter(p => p.mode === 'bw').length;
      const lineTotal = (bwPages * bwPerPage + colorPages * colorPerPage) * f.spec.copies;
      fallbackTotal += lineTotal;
      fallbackLines.push({
        paperSize: f.spec.paperSize,
        colorMode: colorPages > 0 ? 'COLOR' : 'BW',
        sides: f.spec.sides,
        paperType: f.spec.paperType,
        pages: bwPages + colorPages,
        copies: f.spec.copies,
        perPagePaise: colorPages > 0 ? colorPerPage : bwPerPage,
        linePaise: lineTotal,
        ruleMissing: false,
      });
    }
    if (fallbackTotal < minOrder) fallbackTotal = minOrder;
    const urgentPaise = urgent ? Math.ceil(fallbackTotal * 0.1) : 0;
    return {
      lines: fallbackLines,
      subtotalPaise: fallbackTotal,
      addonsPaise: 0,
      addonsDetail: [],
      urgentPaise,
      totalPaise: fallbackTotal + urgentPaise,
      ruleMissing: false,
      warnings: [...warnings, 'Using estimated pricing — confirm the exact amount at the shop.'],
    };
  }

  return { ...price, warnings };
}

/** Place the order: recompute everything server-side, snapshot, transition. */
export async function placeOrder(shop: Record<string, unknown>, order: { id: string; customerToken: string; status: string; notes: string | null }, addonIds: string[], urgent: boolean, clientTotalPaise: number | null, customerName: string | null, customerPhone: string | null, note: string | null): Promise<{
  orderId: string;
  token: string;
  pickupCode: string;
  orderNumber: string;
  totalPaise: number;
  pricesChanged: boolean;
}> {
  const db = getContainer().db;
  const shopId = shop.id as string;

  if ((shop.acceptingOrders as boolean) === false || (shop.isOpen as boolean) === false) {
    throw new ValidationError('This shop is not accepting orders right now.');
  }
  const files = await repos.files.findByOrder(order.id);
  const printable = files.filter(f => f.status === 'ready' && f.pdfStorageKey);
  if (printable.length === 0) {
    throw new ValidationError('Add at least one processed file before placing the order.');
  }

  // Build the file specs (client may have attached specs via the options API)
  const draftFiles: DraftFileSpec[] = [];
  for (const f of printable) {
    const specRow = await db.findOne<{ pageModes: unknown; copies: number; sides: string; pagesPerSheet: number; paperSize: string; paperType: string; collate: boolean }>('printSpec', { orderFileId: f.id });
    if (!specRow) throw new ValidationError(`Choose print options for ${f.originalFilename} first.`);
    draftFiles.push({
      fileId: f.id,
      spec: {
        pageModes: specRow.pageModes as DraftFileSpec['spec']['pageModes'],
        copies: specRow.copies,
        sides: specRow.sides as 'SINGLE' | 'DOUBLE',
        pagesPerSheet: specRow.pagesPerSheet as 1 | 2 | 4 | 6 | 9,
        paperSize: specRow.paperSize,
        paperType: specRow.paperType,
        collate: specRow.collate,
      },
    });
  }

  const { rules, addons } = await shopRulesForShop(shopId);
  const selected = addons.filter(a => addonIds.includes(a.id)).map(a => ({ addon: a }));
  const quote = await quoteOrder(shopId, draftFiles, selected, urgent);
  if (quote.totalPaise === null || quote.ruleMissing) {
    throw new ValidationError('Pricing rules changed for some pages — the shop needs to review this order. Contact the shop.');
  }
  const pricesChanged = clientTotalPaise !== null && clientTotalPaise !== quote.totalPaise;
  if (pricesChanged) {
    // tell the client to re-review; nothing persisted
    throw Object.assign(new ValidationError('Prices changed while you were ordering. Review the new total to continue.'), { code: 'PRICES_CHANGED', newTotalPaise: quote.totalPaise, newQuote: quote });
  }

  const paymentMode = (shop.paymentMode as string) ?? 'UPI_THEN_PRINT';
  const nextStatus = paymentMode === 'UPI_THEN_PRINT' ? 'awaiting_payment' : 'queued';
  assertOrderTransition(order.status as Parameters<typeof assertOrderTransition>[0], nextStatus as Parameters<typeof assertOrderTransition>[0]);

  const orderNumber = String(4000 + Math.floor(Math.random() * 5999));
  const pickupCode = String(Math.floor(Math.random() * 9000) + 1000);
  const now = new Date();
  const expiryMinutes = (shop.orderExpiryMinutes as number) ?? 30;

  await db.update('order', { id: order.id }, {
    status: nextStatus,
    customerName,
    customerPhone,
    notes: note ?? order.notes ?? null,
    subtotalPaise: quote.subtotalPaise,
    addonsPaise: quote.addonsPaise,
    totalAmountPaise: quote.totalPaise,
    priceSnapshot: { lines: quote.lines, addons: quote.addonsDetail, urgentPaise: quote.urgentPaise, computedAt: now.toISOString() },
    orderNumber,
    pickupCode,
    urgent,
    placedAt: now,
    expiresAt: nextStatus === 'awaiting_payment' ? new Date(now.getTime() + expiryMinutes * 60000) : null,
    paymentModeAtOrder: paymentMode,
    updatedAt: now,
  });

  await repos.orderEvents.append(order.id, {
    type: nextStatus === 'awaiting_payment' ? 'order_placed' : 'order_placed_counter',
    actorType: 'customer',
    actorId: null,
    data: { totalPaise: quote.totalPaise, files: printable.length, urgent },
  });

  // Build tasks NOW for PRINT_THEN_PAY (paper first); UPI flow builds at paid.
  if (nextStatus === 'queued') {
    const { buildTasksForOrder } = await import('@/lib/dispatch/task-builder');
    await buildTasksForOrder(order.id);
    await repos.orderEvents.append(order.id, { type: 'queued', actorType: 'system', actorId: null, data: null });
  }

  return {
    orderId: order.id,
    token: order.customerToken,
    pickupCode,
    orderNumber,
    totalPaise: quote.totalPaise,
    pricesChanged: false,
  };
}

/** Customer submits the UTR (or chooses counter payment). */
export async function submitPayment(token: string, input: {
  method: 'upi' | 'counter_cash' | 'counter_upi';
  utr?: string;
  screenshotBytes?: Uint8Array;
  /**
   * P9-Security §4: the customer's declared payment amount (from the UPI
   * app's confirmation screen). If supplied and it does NOT match the
   * order's `totalAmountPaise`, the submission is rejected with
   * `AMOUNT_MISMATCH` — the shopkeeper is not shown a misleading "paid"
   * notification for a wrong-amount transfer. Optional for backward
   * compat with clients that don't send it; the shopkeeper's manual
   * verification is the safety net when omitted.
   */
  declaredAmountPaise?: number;
}): Promise<{ paymentId: string; status: string }> {
  const db = getContainer().db;
  const order = await db.findOne<{ id: string; shopId: string; status: string; totalAmountPaise: number; orderNumber: string | null; customerToken: string; notes: string | null }>('order', { customerToken: token });
  if (!order) throw new NotFoundError('Order not found');
  const shop = await db.findOne<Record<string, unknown>>('shop', { id: order.shopId });

  try {
    assertOrderTransition(order.status as Parameters<typeof assertOrderTransition>[0], 'payment_submitted');
  } catch (cause) {
    if (cause instanceof IllegalTransitionError) {
      throw new ValidationError(`This order is ${order.status} — payment can only be submitted before printing.`);
    }
    throw cause;
  }

  if (input.method === 'upi') {
    if (!input.utr || !isValidUtr(input.utr)) {
      throw new ValidationError('Enter the 12-digit UTR / reference number from your UPI app.');
    }
  }

  // P9-Security §4: amount mismatch flag. The customer's declared amount
  // must equal the order total exactly (paise — no float tolerance). A
  // mismatch means the customer paid the wrong amount and the shopkeeper
  // should NOT be told "this order is paid".
  if (input.method === 'upi' && input.declaredAmountPaise !== undefined && input.declaredAmountPaise !== order.totalAmountPaise) {
    throw new ValidationError(
      `Amount mismatch — you entered Rs ${(input.declaredAmountPaise / 100).toFixed(2)} but the order total is Rs ${(order.totalAmountPaise / 100).toFixed(2)}. Re-check the amount in your UPI app and try again.`,
    );
  }

  // P9-Security §4: duplicate UTR detection across the same shop. A single
  // UTR can only legitimately map to ONE order in a shop. If the customer
  // resubmits the same UTR for a DIFFERENT order in the same shop, that's
  // fraud (using one UPI payment to credit two orders). We exclude:
  //   - The current order (idempotent retry on the SAME order is allowed).
  //   - Payments in REJECTED status (the customer re-paid after a reject).
  if (input.method === 'upi' && input.utr) {
    const dupes = await db.findMany<{ id: string; orderId: string; status: string }>(
      'payment',
      { utr: input.utr },
      { limit: 50 },
    );
    for (const p of dupes) {
      if (p.orderId === order.id) continue; // same order — idempotent retry
      if (p.status === 'REJECTED') continue; // rejected → not blocking
      // Look up the other order's shopId — duplicate scope is per-shop.
      const otherOrder = await db.findOne<{ shopId: string }>('order', { id: p.orderId });
      if (otherOrder?.shopId === order.shopId) {
        throw new ValidationError(
          `This UTR (${input.utr}) was already submitted for another order in this shop. Each UPI payment can only be linked to one order — if you meant to pay for both, make two separate UPI transfers.`,
        );
      }
    }
  }

  // P9-Security §4: screenshot size + type limits. The shopkeeper reviews
  // these on a phone — cap at 2 MB and require PNG or JPEG magic bytes.
  // Rejects oversized files (bandwidth + storage abuse) and wrong types
  // (a `.exe` renamed `.png` would crash the shopkeeper's image viewer).
  let screenshotKey: string | null = null;
  if (input.screenshotBytes && input.screenshotBytes.length > 0) {
    const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
    if (input.screenshotBytes.length > MAX_SCREENSHOT_BYTES) {
      throw new ValidationError(
        `Screenshot is too large — the limit is 2 MB. Crop or downscale the image and try again.`,
      );
    }
    const sb = input.screenshotBytes;
    const isPng = sb.length >= 8 && sb[0] === 0x89 && sb[1] === 0x50 && sb[2] === 0x4e && sb[3] === 0x47;
    const isJpeg = sb.length >= 3 && sb[0] === 0xff && sb[1] === 0xd8;
    if (!isPng && !isJpeg) {
      throw new ValidationError(
        `Screenshot must be a PNG or JPEG image. Other formats are not accepted.`,
      );
    }
    const ext = isPng ? 'png' : 'jpg';
    const mime = isPng ? 'image/png' : 'image/jpeg';
    screenshotKey = `shops/${order.shopId}/orders/${order.id}/pay/screenshot-${Date.now()}.${ext}`;
    await getContainer().storage.put?.(screenshotKey, input.screenshotBytes, mime);
  }

  const payeeName = (shop?.upiPayeeName as string) ?? (shop?.name as string) ?? '';
  const upiIntentUrl = (shop?.upiId as string)
    ? buildUpiIntentUrl({ payeeUpi: shop?.upiId as string, payeeName, amountPaise: order.totalAmountPaise, orderShortId: (order.orderNumber ?? order.id.slice(0, 8)) })
    : null;

  const payment = await repos.payments.createForOrder(order.id, {
    method: input.method,
    status: input.method === 'upi' ? 'SUBMITTED' : 'PENDING',
    amountPaise: order.totalAmountPaise,
    upiIntentUrl,
    utr: input.utr ?? null,
    screenshotStorageKey: screenshotKey,
    confirmedBy: null,
    confirmedAt: null,
    rejectReason: null,
  });

  await db.update('order', { id: order.id }, { status: 'payment_submitted', paymentUtr: input.utr ?? null, updatedAt: new Date() });
  await repos.orderEvents.append(order.id, {
    type: 'payment_submitted',
    actorType: 'customer',
    actorId: null,
    data: { method: input.method, utr: input.utr ?? null, amountPaise: order.totalAmountPaise },
  });
  await repos.notifications.createForShop(order.shopId, {
    kind: 'payment_submitted',
    orderId: order.id,
    payload: { amountPaise: order.totalAmountPaise, method: input.method, utr: input.utr ?? null },
  });

  return { paymentId: payment.id, status: payment.status };
}

/** Cancel — only before PRINTING (state machine enforces). */
export async function cancelOrder(token: string, reason: string): Promise<{ cancelled: boolean }> {
  const db = getContainer().db;
  const order = await db.findOne<{ id: string; shopId: string; status: string; customerToken: string }>('order', { customerToken: token });
  if (!order) throw new NotFoundError('Order not found');
  assertOrderTransition(order.status as Parameters<typeof assertOrderTransition>[0], 'cancelled');
  await db.update('order', { id: order.id }, {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelReason: reason.slice(0, 300),
    updatedAt: new Date(),
  });
  // cancel any queued tasks
  const jobs = await repos.printJobs.findAllByShop(order.shopId, 200);
  for (const j of jobs) {
    if (j.fileId && (await repos.files.findById(j.fileId))?.orderId === order.id && ['queued', 'dispatched', 'assigned'].includes(j.status)) {
      await repos.printJobs.update(j.id, { status: 'cancelled', lastError: 'Order cancelled by customer' });
    }
  }
  await repos.orderEvents.append(order.id, { type: 'cancelled', actorType: 'customer', actorId: null, data: { reason: reason.slice(0, 300) } });
  return { cancelled: true };
}

/** Tracking payload for /o/[token] — no login. */
export async function orderTracking(token: string) {
  const db = getContainer().db;
  const order = await db.findOne<{ id: string; shopId: string; status: string; expiresAt: Date | null; pickupCode: string | null; orderNumber: string | null; customerName: string | null; customerToken: string; totalAmountPaise: number; subtotalPaise: number; addonsPaise: number; urgent: boolean; placedAt: Date | null; paidAt: Date | null; readyAt: Date | null; collectedAt: Date | null; cancelledAt: Date | null; cancelReason: string | null; priceSnapshot: unknown; paymentModeAtOrder: string | null }>('order', { customerToken: token });
  if (!order) throw new NotFoundError('Order not found');
  // P9-Security §1: an expired awaiting_payment order is treated the SAME as
  // an unknown token — return NotFoundError so the response shape matches
  // the unknown-token case (no enumeration). The order is still in the DB
  // for the shopkeeper's records, but the customer URL no longer resolves.
  // We only do this for `awaiting_payment` (the pre-payment window); after
  // payment the order is durable and the customer should always be able to
  // track it, even if the shop is slow to mark it ready / collected.
  if (order.status === 'awaiting_payment' && order.expiresAt && order.expiresAt.getTime() < Date.now()) {
    throw new NotFoundError('Order not found');
  }
  const shop = await db.findOne<{ id: string; name: string; address: string; phone: string; upiPayeeName: string | null }>('shop', { id: order.shopId });
  const files = await repos.files.findByOrder(order.id);
  const events = await repos.orderEvents.forOrder(order.id);
  const payments = await repos.payments.forOrder(order.id);
  const tasks: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const fileTasks = await repos.printJobs.findByFile(f.id);
    tasks.push(...fileTasks.map(t => ({
      id: t.id,
      fileId: f.id,
      kind: t.kind,
      colorMode: t.colorMode,
      sheetCount: t.sheetCount,
      copies: t.copies ?? null,
      setLabel: t.setLabel,
      status: t.status,
      printerId: t.printerId,
      lastError: t.lastError,
    })));
  }
  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalPaise: order.totalAmountPaise,
      subtotalPaise: order.subtotalPaise,
      addonsPaise: order.addonsPaise,
      pickupCode: order.pickupCode,
      urgent: order.urgent,
      placedAt: order.placedAt,
      paidAt: order.paidAt,
      readyAt: order.readyAt,
      collectedAt: order.collectedAt,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      priceSnapshot: order.priceSnapshot,
      paymentModeAtOrder: order.paymentModeAtOrder,
    },
    shop: shop ? { name: shop.name, address: shop.address, phone: shop.phone } : null,
    upiIntentUrl: payments[0]?.upiIntentUrl ?? null,
    payment: payments[0] ? { method: payments[0].method, status: payments[0].status, utr: payments[0].utr, rejectReason: payments[0].rejectReason } : null,
    files: files.map(f => ({
      id: f.id,
      name: f.originalFilename,
      status: f.status,
      pageCount: f.pageCount,
      colorSuggestion: f.colorSuggestion,
    })),
    tasks,
    events: events.map(e => ({ type: e.type, actorType: e.actorType, at: e.createdAt, data: e.data })),
  };
}

/** Shopkeeper confirms a SUBMITTED payment → order PAID → tasks built. */
export async function confirmPayment(orderId: string, shopId: string, confirmedBy: string, method?: 'upi' | 'counter_cash' | 'counter_upi'): Promise<{ status: string; tasksCreated: number }> {
  const db = getContainer().db;
  const order = await db.findOne<{ id: string; shopId: string; status: string }>('order', { id: orderId });
  if (!order || order.shopId !== shopId) throw new NotFoundError('Order not found');
  const payments = await repos.payments.forOrder(order.id);
  const payment = payments[0];
  if (!payment) throw new NotFoundError('No payment for this order');
  if (payment.status !== 'SUBMITTED' && payment.status !== 'PENDING') {
    throw new ValidationError(`This payment is already ${payment.status}.`);
  }

  // counter payment (PENDING) confirms straight to PAID; UPI SUBMITTED too
  await repos.payments.update(payment.id, {
    status: 'CONFIRMED',
    method: method ?? payment.method,
    confirmedBy,
    confirmedAt: new Date(),
  });
  assertOrderTransition(order.status as Parameters<typeof assertOrderTransition>[0], 'paid');
  await db.update('order', { id: order.id }, { status: 'paid', paidAt: new Date(), updatedAt: new Date() });
  await repos.orderEvents.append(order.id, { type: 'payment_confirmed', actorType: 'shop', actorId: confirmedBy, data: { method: method ?? payment.method } });

  // paid → queued + build tasks
  assertOrderTransition('paid', 'queued');
  await db.update('order', { id: order.id }, { status: 'queued', updatedAt: new Date() });
  const { buildTasksForOrder } = await import('@/lib/dispatch/task-builder');
  const built = await buildTasksForOrder(order.id);
  await repos.orderEvents.append(order.id, { type: 'queued', actorType: 'system', actorId: null, data: { tasksCreated: built.tasksCreated } });
  return { status: 'queued', tasksCreated: built.tasksCreated };
}

/** Shopkeeper rejects a UPI submission (wrong amount, not received…). */
export async function rejectPayment(orderId: string, shopId: string, confirmedBy: string, reason: string): Promise<{ status: string }> {
  const db = getContainer().db;
  const order = await db.findOne<{ id: string; shopId: string; status: string }>('order', { id: orderId });
  if (!order || order.shopId !== shopId) throw new NotFoundError('Order not found');
  const payments = await repos.payments.forOrder(order.id);
  const payment = payments[0];
  if (!payment) throw new NotFoundError('No payment for this order');
  await repos.payments.update(payment.id, { status: 'REJECTED', confirmedBy, rejectReason: reason.slice(0, 300) });
  // the customer can resubmit a UTR — back to awaiting_payment
  assertOrderTransition(order.status as Parameters<typeof assertOrderTransition>[0], 'awaiting_payment');
  await db.update('order', { id: order.id }, { status: 'awaiting_payment', paymentUtr: null, updatedAt: new Date() });
  await repos.orderEvents.append(order.id, { type: 'payment_rejected', actorType: 'shop', actorId: confirmedBy, data: { reason: reason.slice(0, 300) } });
  return { status: 'awaiting_payment' };
}

/** After a task status change: move the order through printing → partially
 *  printed → ready (READY only when ALL tasks printed). */
export async function refreshOrderPrintState(orderId: string): Promise<string> {
  const db = getContainer().db;
  const order = await db.findOne<{ id: string; shopId: string; status: string }>('order', { id: orderId });
  if (!order) throw new NotFoundError('Order not found');
  const files = await repos.files.findByOrder(orderId);
  const statuses: string[] = [];
  for (const f of files) {
    const tasks = await repos.printJobs.findByFile(f.id);
    statuses.push(...tasks.map(t => t.status));
  }
  if (statuses.length === 0) return order.status;
  const allPrinted = statuses.every(s => s === 'printed' || s === 'completed' || s === 'cancelled');
  const anyProgress = statuses.some(s => ['dispatched', 'received', 'printing', 'spooled', 'printed', 'completed', 'uncertain', 'failed', 'cancelled'].includes(s));

  let target = order.status as Parameters<typeof assertOrderTransition>[0];
  if (allPrinted && ['printing', 'partially_printed', 'queued'].includes(order.status)) {
    target = assertOrderTransition(order.status as Parameters<typeof assertOrderTransition>[0], 'ready');
    await db.update('order', { id: order.id }, { status: 'ready', readyAt: new Date(), updatedAt: new Date() });
    await repos.orderEvents.append(orderId, { type: 'ready', actorType: 'system', actorId: null, data: null });
    await repos.notifications.createForShop(order.shopId, { kind: 'order_ready', orderId, payload: {} });
  } else if (anyProgress && ['queued', 'printing'].includes(order.status)) {
    const somePrinted = statuses.some(s => s === 'printed' || s === 'completed');
    const next = somePrinted ? 'partially_printed' : 'printing';
    if (order.status !== next) {
      target = assertOrderTransition(order.status as Parameters<typeof assertOrderTransition>[0], next as Parameters<typeof assertOrderTransition>[0]);
      await db.update('order', { id: order.id }, { status: next, updatedAt: new Date() });
      await repos.orderEvents.append(orderId, { type: next, actorType: 'agent', actorId: null, data: null });
    }
  }
  return target;
}

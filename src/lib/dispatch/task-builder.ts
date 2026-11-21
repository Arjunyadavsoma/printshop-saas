import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { planPrintJob } from '@/lib/printing/planner';
import type { PlannerPrinter, PlannerSpec } from '@/lib/printing/planner';
import { buildTaskPdf } from '@/lib/printing/task-pdf';
import { computeOrderPrice } from '@/lib/pricing/price-engine';
import type { RuleLike, PricingBreakdown } from '@/lib/pricing/price-engine';
import { shouldMarkReady } from '@/lib/orders/state-machine';

/**
 * Task builder (Phase 4/6): for every READY file with a PrintSpec, runs the
 * PrintPlanner and materialises PrintJob tasks (idempotencyKey
 * {orderId}:{fileId}:{kind}) with their imposed task PDFs in storage.
 * Called at PAID (UPI flow) or at QUEUED (PRINT_THEN_PAY) and again safely
 * on retries (idempotencyKey unique).
 */
export async function buildTasksForOrder(orderId: string, opts?: { skipTaskPdfs?: boolean }): Promise<{ tasksCreated: number; allPrinted: boolean }> {
  const db = getContainer().db;
  const storage = getContainer().storage;
  const order = await db.findOne<{ id: string; shopId: string; priceSnapshot: unknown }>('order', { id: orderId });
  if (!order) throw new Error('order not found');
  const shopId = order.shopId;

  const ruleRows = await repos.priceRules.activeForShop(shopId);
  const rules = ruleRows as unknown as RuleLike[];
  const { makeRateFor } = await import('@/lib/pricing/price-engine');
  const rateFor = makeRateFor(rules);
  const printerRows = await repos.printers.listForShop(shopId);
  const printers: PlannerPrinter[] = printerRows.filter(p => p.enabled).map(p => ({
    id: p.id, supportsColor: p.supportsColor, supportsDuplex: p.supportsDuplex,
    paperSizes: (p.paperSizes ?? []) as string[], isDefaultColor: p.isDefaultColor,
    isDefaultBw: p.isDefaultBw, status: p.status, enabled: p.enabled,
  }));

  const files = await repos.files.findByOrder(orderId);
  let tasksCreated = 0;
  const allStatuses: string[] = [];

  for (const file of files) {
    if (file.status !== 'ready' || !file.pdfStorageKey) continue;
    const specRow = await db.findOne<{ pageModes: unknown; copies: number; sides: string; pagesPerSheet: number; paperSize: string; paperType: string; collate: boolean }>('printSpec', { orderFileId: file.id });
    if (!specRow) continue;

    const spec = {
      pageModes: specRow.pageModes as PlannerSpec['pageModes'],
      copies: specRow.copies,
      sides: specRow.sides as 'SINGLE' | 'DOUBLE',
      pagesPerSheet: specRow.pagesPerSheet as 1 | 2 | 4 | 6 | 9,
      paperSize: specRow.paperSize,
      paperType: specRow.paperType,
      collate: specRow.collate,
    } as PlannerSpec;

    const plan = planPrintJob({
      spec,
      printers,
      rateFor,
      colorSheetBilling: 'PER_PAGE_ACTUAL',
    });

    const sourceBytes = (await storage.getBytes?.(file.pdfStorageKey))?.bytes ?? null;

    for (const task of plan.tasks) {
      const idempotencyKey = `${orderId}:${file.id}:${task.kind}`;
      // idempotent: a retry after a crash must not duplicate tasks
      const existing = await db.findOne<{ id: string }>('printJob', { idempotencyKey });
      if (existing) {
        allStatuses.push('queued');
        continue;
      }

      let taskPdfKey: string | null = null;
      if (!opts?.skipTaskPdfs && sourceBytes) {
        try {
          const pdfBytes = await buildTaskPdf(sourceBytes, task);
          taskPdfKey = `shops/${shopId}/orders/${orderId}/tasks/${file.id}_${task.kind}.pdf`;
          await storage.put?.(taskPdfKey, pdfBytes, 'application/pdf');
        } catch { /* task PDF unavailable — the agent can still fetch the normalized pdf */ }
      }

      const job = await repos.printJobs.create({
        shopId,
        fileId: file.id,
        printerId: task.printerId,
        kind: task.kind,
        sourcePages: task.sourcePages,
        taskPdfStorageKey: taskPdfKey,
        sheetCount: task.sheetCount,
        copies: task.copies,
        colorMode: task.colorMode,
        paperSize: task.paperSize,
        duplex: task.duplex,
        pagesPerSheet: task.pagesPerSheet,
        orientation: null,
        scale: null,
        setLabel: task.setLabel,
        idempotencyKey,
        status: 'queued',
        attempts: 0,
        lastError: null,
      });
      allStatuses.push(job.status);
      tasksCreated += 1;
    }
  }

  return { tasksCreated, allPrinted: shouldMarkReady(allStatuses) };
}

/** Recompute the order's pricing at place time — exported for routes that
 *  need the snapshot without building tasks. */
export async function priceOrderForSnapshot(orderId: string) {
  const db = getContainer().db;
  const order = await db.findOne<{ shopId: string }>('order', { id: orderId });
  if (!order) throw new Error('order not found');
  const files = await repos.files.findByOrder(orderId);
  const ruleRows = await repos.priceRules.activeForShop(order.shopId);
  const rules = ruleRows as unknown as RuleLike[];
  const { makeRateFor } = await import('@/lib/pricing/price-engine');
  const rateFor = makeRateFor(rules);
  const pricings: PricingBreakdown[] = [];
  for (const file of files) {
    const specRow = await db.findOne<{ pageModes: unknown; copies: number; sides: string; pagesPerSheet: number; paperSize: string; paperType: string; collate: boolean }>('printSpec', { orderFileId: file.id });
    if (!specRow || file.status !== 'ready') continue;
    const plan = planPrintJob({
      spec: { pageModes: specRow.pageModes as PlannerSpec['pageModes'], copies: specRow.copies, sides: specRow.sides as 'SINGLE' | 'DOUBLE', pagesPerSheet: specRow.pagesPerSheet as 1, paperSize: specRow.paperSize, paperType: specRow.paperType, collate: specRow.collate },
      printers: [],
      rateFor,
    });
    pricings.push(plan.pricing);
  }
  return computeOrderPrice({ filePricings: pricings, rules, addons: [], totalSheets: 0, totalCopies: 1, urgent: false, urgentSurchargePaise: 0 });
}

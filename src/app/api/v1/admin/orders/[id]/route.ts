import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/admin/orders/:id — full order detail + files + status history (admin only).
 */
export const GET = withAuth<{ id: string }>(async (_req, ctx) => {
  try {
    const { id } = await ctx.params;
    // Admin can access any order — use findById (not tenant-scoped)
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');

    const shop = await repos.shops.findById(order.shopId);
    const files = await repos.files.findByOrder(order.id);
    const printJobs = await repos.printJobs.findAllByShop(order.shopId, 50);
    const orderJobs = printJobs.filter((j) => files.some((f) => f.id === j.fileId));

    return ok({
      order: {
        id: order.id,
        shopId: order.shopId,
        shopName: shop?.name ?? 'Unknown',
        shopSlug: shop?.slug ?? '',
        customerToken: order.customerToken,
        status: order.status,
        totalAmountPaise: order.totalAmountPaise,
        currency: order.currency,
        paymentProvider: order.paymentProvider,
        paymentTxnId: order.paymentTxnId,
        paymentUtr: order.paymentUtr,
        paidAt: order.paidAt,
        customerPhone: order.customerPhone,
        notes: order.notes,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      files: files.map((f) => ({
        id: f.id,
        originalFilename: f.originalFilename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        pageCount: f.pageCount,
        copies: f.copies,
        colorMode: f.colorMode,
        pageRange: f.pageRange,
        paperSize: f.paperSize,
        duplex: f.duplex,
        pricePaise: f.pricePaise,
        status: f.status,
        printedAt: f.printedAt,
        createdAt: f.createdAt,
      })),
      printJobs: orderJobs.map((j) => ({
        id: j.id,
        fileId: j.fileId,
        agentId: j.agentId,
        status: j.status,
        attempts: j.attempts,
        lastError: j.lastError,
        queuedAt: j.queuedAt,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        createdAt: j.createdAt,
      })),
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['admin']);

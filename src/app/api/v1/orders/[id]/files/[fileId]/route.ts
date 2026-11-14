import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { priceFileFromRecord, recalcOrderTotal } from '@/lib/pricing/price-file';
import type { PrintFile, PageCountSource } from '@platform/core/domain';

const PatchFileSchema = z.object({
  copies: z.number().int().min(1).max(500).optional(),
  colorMode: z.enum(['bw', 'color']).optional(),
  pageRange: z.string().max(100).nullable().optional(),
  paperSize: z.enum(['a4', 'a3', 'letter', 'legal']).optional(),
  duplex: z.boolean().optional(),
  /** Customer-set page count — marks the source as `customer_declared`. */
  pageCount: z.number().int().min(1).max(10000).optional(),
});

/** PATCH /api/v1/orders/:id/files/:fileId — update print settings + reprice.
 *
 * The customer can update copies, colour, paper, duplex, page range, and
 * page count. When a page count is supplied for a placeholder file, the
 * source becomes `customer_declared` and the file transitions from
 * `needs_review` to `pending` (priced).
 *
 * SEC-001: behind withOrderAccess — caller must present the order's
 * `customerToken` before any mutation. */
export const PATCH = withRateLimit<{ id: string; fileId: string }>(
  'patch-file',
  60,
  60,
  withOrderAccess<{ id: string; fileId: string }>(async (req, ctx, order) => {
    try {
    const { fileId } = await ctx.params;
    if (order.status !== 'awaiting_payment') {
      throw new ValidationError(`Order in status '${order.status}' cannot be edited`);
    }

    const file = await repos.files.findByIdAndOrder(fileId, order.id);
    if (!file) throw new NotFoundError('File not found');

    const body = PatchFileSchema.parse(await req.json());

    // Build the updated file object (not yet persisted).
    const updated: PrintFile = { ...file, ...body };

    // If the customer supplied a page count, mark the source as
    // customer_declared (unless it was shopkeeper_confirmed, which is higher
    // trust and shouldn't be downgraded by a customer edit).
    if (body.pageCount !== undefined) {
      updated.pageCount = body.pageCount;
      if (file.pageCountSource !== 'shopkeeper_confirmed') {
        updated.pageCountSource = 'customer_declared' as PageCountSource;
      }
    }

    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    // Price the file ONLY if a trustworthy page count is available.
    // Placeholder files (pageCount=null) stay unpriced and in needs_review.
    let pricePaise = file.pricePaise;
    let status = file.status;
    let processingError = file.processingError;
    let lineItems: Awaited<ReturnType<typeof priceFileFromRecord>>['lineItems'] = [];

    if (updated.pageCount !== null && updated.pageCount > 0) {
      try {
        const priced = priceFileFromRecord(updated, shop);
        pricePaise = priced.totalPaise;
        lineItems = priced.lineItems;
        status = 'pending';
        processingError = null;
      } catch (pricingErr) {
        // Re-throw ValidationError (invalid page range, invalid page count) —
        // the customer gets a 400 with a clear error message, not a silent
        // needs_review state.
        if (pricingErr instanceof ValidationError) throw pricingErr;
        // Other pricing errors (missing config, etc.) → needs_review.
        const msg = pricingErr instanceof Error ? pricingErr.message : 'Pricing failed';
        status = 'needs_review';
        processingError = msg;
        pricePaise = 0;
      }
    } else {
      status = 'needs_review';
      processingError = processingError ?? 'Page count is required before pricing.';
      pricePaise = 0;
    }

    const saved = await repos.files.update(file.id, {
      ...body,
      pageCount: updated.pageCount,
      pageCountSource: updated.pageCountSource,
      pricePaise,
      status,
      processingError,
    });

    const orderTotal = await recalcOrderTotal(order.id);

    return ok({
      file: {
        id: saved.id,
        pageCount: saved.pageCount,
        pageCountSource: saved.pageCountSource,
        copies: saved.copies,
        colorMode: saved.colorMode,
        paperSize: saved.paperSize,
        duplex: saved.duplex,
        pricePaise: saved.pricePaise,
        status: saved.status,
        processingError: saved.processingError,
      },
      orderTotalPaise: orderTotal,
      lineItems,
    });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  }),
);

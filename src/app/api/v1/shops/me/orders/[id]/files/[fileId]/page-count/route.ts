import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withAuth } from '@/lib/api/with-auth';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { priceFile, type PricingInput } from '@platform/core/pricing';
import { resolveBillablePages } from '@/lib/pricing/page-selection';

const SetPageCountSchema = z.object({
  pageCount: z.number().int().positive().max(10000),
});

/**
 * POST /api/v1/shops/me/orders/:id/files/:fileId/page-count
 *
 * Shopkeeper-only endpoint to manually set the page count for a file
 * that requires review (status='needs_review'). This is used when
 * automatic page-count extraction fails (e.g., legacy .doc files,
 * corrupted PDFs, or formats the parser doesn't support).
 *
 * After setting the page count, the file is automatically priced using
 * the shop's current pricing configuration and the file's existing
 * print settings (copies, colorMode, paperSize, duplex, pageRange).
 *
 * Authorization: owner or staff role only (via withAuth).
 * Tenant isolation: the file must belong to an order in the shopkeeper's shop.
 *
 * Audit: records who set the page count, when, and the previous value.
 */
export const POST = withAuth<{ id: string; fileId: string }>(
  async (req, ctx, principal) => {
    try {
      const { id: orderId, fileId } = await ctx.params;
      const body = SetPageCountSchema.parse(await req.json());

      // Verify the order belongs to the shopkeeper's shop
      const shop = await repos.shops.getByOwner(principal.userId);
      const order = await repos.orders.findByIdAndShop(orderId, shop.id);
      if (!order) throw new NotFoundError('Order not found in your shop');

      const file = await repos.files.findByIdAndOrder(fileId, orderId);
      if (!file) throw new NotFoundError('File not found');

      // Only allow setting page count for files that need review
      if (file.status !== 'needs_review') {
        throw new ValidationError(
          `File status is '${file.status}' — page count can only be set for files awaiting review`,
        );
      }

      const previousPageCount = file.pageCount;

      // Resolve billable pages using the file's existing pageRange
      const resolved = resolveBillablePages(file.pageRange, body.pageCount);
      if ('error' in resolved) {
        throw new ValidationError(resolved.error);
      }

      // Price the file using the shop's current pricing configuration
      const pricingInput: PricingInput = {
        pages: resolved.billablePages,
        copies: file.copies,
        colorMode: file.colorMode,
        paperSize: file.paperSize,
        duplex: file.duplex,
        shopPricingConfig: shop.pricingConfig,
      };
      const result = priceFile(pricingInput);

      // Update the file: set page count, price, and transition from needs_review to pending
      const updated = await repos.files.update(fileId, {
        pageCount: body.pageCount,
        pricePaise: result.totalPaise,
        status: 'pending',
      });

      // Recalculate the order total
      const siblings = await repos.files.findByOrder(orderId);
      const orderTotal = siblings.reduce((acc, f) => acc + f.pricePaise, 0);
      await repos.orders.update(orderId, { totalAmountPaise: orderTotal });

      // Audit log
      await repos.audit.log({
        shopId: shop.id,
        userId: principal.userId,
        action: 'file.page_count_override',
        entityType: 'file',
        entityId: fileId,
        metadata: {
          previousPageCount,
          newPageCount: body.pageCount,
          pricePaise: result.totalPaise,
          orderTotalPaise: orderTotal,
        },
        ip: req.headers.get('x-forwarded-for') ?? null,
      });

      return ok({
        file: {
          id: updated.id,
          pageCount: updated.pageCount,
          pricePaise: updated.pricePaise,
          status: updated.status,
        },
        orderTotalPaise: orderTotal,
        lineItems: result.lineItems,
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
  ['owner', 'staff'],
);

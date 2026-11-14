import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withAuth } from '@/lib/api/with-auth';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { priceFileFromRecord, recalcOrderTotal } from '@/lib/pricing/price-file';

const SetPageCountSchema = z.object({
  pageCount: z.number().int().positive().max(10000),
});

/**
 * POST /api/v1/shops/me/orders/:id/files/:fileId/page-count
 *
 * Shopkeeper-only endpoint to set or correct a file's page count. The source
 * is marked `shopkeeper_confirmed` (highest trust). The file is priced using
 * the shop's current config and transitions to `pending`.
 *
 * Works for any file status — the shopkeeper can correct an auto-extracted
 * count, override a customer-declared count, or resolve a placeholder.
 *
 * Authorization: owner or staff role only (via withAuth).
 * Tenant isolation: the file must belong to an order in the shopkeeper's shop.
 * Audit: records who set the page count, when, and the previous value.
 */
export const POST = withAuth<{ id: string; fileId: string }>(
  async (req, ctx, principal) => {
    try {
      const { id: orderId, fileId } = await ctx.params;
      const body = SetPageCountSchema.parse(await req.json());

      const shop = await repos.shops.getByOwner(principal.userId);
      const order = await repos.orders.findByIdAndShop(orderId, shop.id);
      if (!order) throw new NotFoundError('Order not found in your shop');

      const file = await repos.files.findByIdAndOrder(fileId, orderId);
      if (!file) throw new NotFoundError('File not found');

      const previousPageCount = file.pageCount;
      const previousSource = file.pageCountSource;

      const fileForPricing = {
        ...file,
        pageCount: body.pageCount,
        pageCountSource: 'shopkeeper_confirmed' as const,
      };

      const priced = priceFileFromRecord(fileForPricing, shop);

      const updated = await repos.files.update(fileId, {
        pageCount: body.pageCount,
        pageCountSource: 'shopkeeper_confirmed',
        pricePaise: priced.totalPaise,
        status: 'pending',
        processingError: null,
      });

      const orderTotal = await recalcOrderTotal(orderId);

      await repos.audit.log({
        shopId: shop.id,
        userId: principal.userId,
        action: 'file.page_count_override',
        entityType: 'file',
        entityId: fileId,
        metadata: {
          previousPageCount,
          previousSource,
          newPageCount: body.pageCount,
          newSource: 'shopkeeper_confirmed',
          pricePaise: priced.totalPaise,
          orderTotalPaise: orderTotal,
        },
        ip: req.headers.get('x-forwarded-for') ?? null,
      });

      return ok({
        file: {
          id: updated.id,
          pageCount: updated.pageCount,
          pageCountSource: updated.pageCountSource,
          pricePaise: updated.pricePaise,
          status: updated.status,
          processingError: updated.processingError,
        },
        orderTotalPaise: orderTotal,
        lineItems: priced.lineItems,
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
  ['owner', 'staff'],
);

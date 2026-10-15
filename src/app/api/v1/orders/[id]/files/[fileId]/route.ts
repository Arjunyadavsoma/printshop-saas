import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { priceFile, type PricingInput } from '@platform/core/pricing';

const PatchFileSchema = z.object({
  copies: z.number().int().min(1).max(500).optional(),
  colorMode: z.enum(['bw', 'color']).optional(),
  pageRange: z.string().max(100).nullable().optional(),
  paperSize: z.enum(['a4', 'a3', 'letter', 'legal']).optional(),
  duplex: z.boolean().optional(),
});

/** PATCH /api/v1/orders/:id/files/:fileId — update print settings + reprice. */
export const PATCH = withRateLimit<{ id: string; fileId: string }>('patch-file', 60, 60, async (req, ctx) => {
  try {
    const { id, fileId } = await ctx.params;
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
    if (order.status !== 'awaiting_payment') {
      throw new ValidationError(`Order in status '${order.status}' cannot be edited`);
    }

    const file = await repos.files.findByIdAndOrder(fileId, order.id);
    if (!file) throw new NotFoundError('File not found');
    if (file.status === 'needs_review') {
      throw new ValidationError('File needs shopkeeper review before settings can be applied');
    }

    const body = PatchFileSchema.parse(await req.json());
    const updated = { ...file, ...body };

    // Recompute this file's price using the shop's pricing config + the real
    // pricing engine from @platform/core.
    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    const pricingInput: PricingInput = {
      pages: file.pageCount ?? 1,
      copies: updated.copies,
      colorMode: updated.colorMode,
      paperSize: updated.paperSize,
      duplex: updated.duplex,
      shopPricingConfig: shop.pricingConfig,
    };
    const result = priceFile(pricingInput);

    const saved = await repos.files.update(file.id, {
      ...body,
      pricePaise: result.totalPaise,
    });

    // Recompute the order total as the sum of all file prices.
    const siblings = await repos.files.findByOrder(order.id);
    const orderTotal = siblings.reduce((acc, f) => acc + f.pricePaise, 0);
    await repos.orders.update(order.id, { totalAmountPaise: orderTotal });

    return ok({
      file: {
        id: saved.id,
        copies: saved.copies,
        colorMode: saved.colorMode,
        paperSize: saved.paperSize,
        duplex: saved.duplex,
        pricePaise: saved.pricePaise,
      },
      orderTotalPaise: orderTotal,
      lineItems: result.lineItems,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

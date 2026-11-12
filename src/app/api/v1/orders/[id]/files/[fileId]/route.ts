import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { priceFile, type PricingInput } from '@platform/core/pricing';
import { resolveBillablePages } from '@/lib/pricing/page-selection';

const PatchFileSchema = z.object({
  copies: z.number().int().min(1).max(500).optional(),
  colorMode: z.enum(['bw', 'color']).optional(),
  pageRange: z.string().max(100).nullable().optional(),
  paperSize: z.enum(['a4', 'a3', 'letter', 'legal']).optional(),
  duplex: z.boolean().optional(),
});

/** PATCH /api/v1/orders/:id/files/:fileId — update print settings + reprice.
 *
 * SEC-001 fix: behind withOrderAccess — caller must present the order's
 * `customerToken` before any print-setting mutation runs. Previously
 * anyone who learned the order UUID could PATCH another customer's files
 * (re-pricing their order, flipping color/duplex, etc.). The `fileId`
 * is still read from ctx.params inside the handler — withOrderAccess only
 * loads + verifies the `order`, the file lookup remains the handler's job. */
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
    // Allow PATCH on needs_review files — the customer can change print settings
    // (copies, color, paper, duplex) even before the shopkeeper verifies the page count.
    // The page count was auto-set to 1 as a default; the shopkeeper can correct it
    // via the /page-count endpoint. Pricing uses the current pageCount.

    const body = PatchFileSchema.parse(await req.json());
    const updated = { ...file, ...body };

    // P1-15 fix: server-authoritative page selection.
    // Before this fix the PATCH endpoint used `file.pageCount` (the FULL
    // document length) for pricing even when the customer supplied a
    // `pageRange` selecting only a subset of pages. A 3-of-200 selection
    // was billed for 200 — direct revenue leakage.
    //
    // Now we parse + validate `pageRange` against `file.pageCount` and use
    // the resulting selected-pages count as the pricing input. When
    // `pageRange` is null/empty (legacy orders, "print all" UX), we
    // fall back to `file.pageCount` — preserving backward compatibility.
    //
    // The `pageRange` value used for pricing is the EFFECTIVE one — body
    // takes precedence (the customer may have just changed it), otherwise
    // the file's previously-persisted `pageRange`. This matches the
    // behaviour of `updated.copies` / `updated.colorMode` etc. below.
    const effectivePageRange = body.pageRange !== undefined ? body.pageRange : updated.pageRange;
    const resolved = resolveBillablePages(effectivePageRange, file.pageCount);
    if ('error' in resolved) {
      throw new ValidationError(resolved.error);
    }
    const billablePages = resolved.billablePages;

    // Recompute this file's price using the shop's pricing config + the real
    // pricing engine from @platform/core.
    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    const pricingInput: PricingInput = {
      pages: billablePages, // ← was `file.pageCount ?? 1` (P1-15 revenue bug)
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
  }),
);

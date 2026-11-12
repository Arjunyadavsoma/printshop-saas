import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { ValidationError } from '@platform/core/errors';
import { parsePageCount } from '@/lib/services/parse-page-count';
import { priceFile, type PricingInput } from '@platform/core/pricing';
import { createDefaultPricingConfig } from '@platform/core/domain';

const ConfirmFileSchema = z.object({
  fileId: z.string().uuid(),
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().int().positive(),
});

/** POST /api/v1/orders/:id/files — confirm an upload, parse page count.
 *
 * SEC-001 fix: behind withOrderAccess — caller must present the order's
 * `customerToken` (X-Order-Token header or ?t= query) before any upload
 * confirmation runs. Previously anyone who learned the order UUID could
 * spam another customer's order with PDFs. */
export const POST = withRateLimit<{ id: string }>(
  'confirm-file',
  30,
  60,
  withOrderAccess<{ id: string }>(async (req, _ctx, order) => {
    try {
    if (order.status !== 'awaiting_payment') {
      throw new ValidationError(`Order in status '${order.status}' cannot accept files`);
    }

    const body = ConfirmFileSchema.parse(await req.json());
    const storage = getContainer().storage;

    // ── Defense-in-depth: the storageKey MUST be in this order's own
    // namespace. Without this check, a customer who has a valid upload-url
    // for order X could POST to /orders/Y/files with the storageKey from
    // order X — the file record would be created under order Y but point at
    // bytes in order X's namespace (cross-order attack within the same
    // shop). The expected prefix is `shops/<shopId>/orders/<orderId>/<fileId>`.
    // The prefix encodes the order's tenant, so this also blocks cross-shop
    // attacks (the customer would need to know another shop's ID, which
    // they don't — but defense-in-depth is cheap here). ──
    const expectedPrefix = `shops/${order.shopId}/orders/${order.id}/`;
    if (!body.storageKey.startsWith(expectedPrefix)) {
      throw new ValidationError(
        `storageKey must be in this order's namespace (expected prefix "${expectedPrefix}")`,
        { receivedPrefix: body.storageKey.split('/').slice(0, 4).join('/') + '/' },
      );
    }

    // Verify the object actually landed in storage (HEAD).
    const head = await storage.head(body.storageKey);
    if (!head) throw new ValidationError('File not found in storage — did the upload complete?');
    if (head.size !== body.size) {
      throw new ValidationError(`Size mismatch: declared ${body.size}, stored ${head.size}`);
    }

    // Parse page count — pdf-lib for PDFs, 1 for images, null for Office.
    const hasGetBytes = typeof (storage as unknown as { getBytes?: unknown }).getBytes === 'function';
    const bytes = hasGetBytes
      ? await (storage as unknown as { getBytes: (k: string) => Promise<{ bytes: Uint8Array } | null> }).getBytes(body.storageKey).then((r) => r?.bytes ?? null)
      : null;
    const pageCount = await parsePageCount(body.mimeType, bytes);
    const needsReview = pageCount === null;

    const file = await repos.files.create({
      orderId: order.id,
      originalFilename: body.filename,
      storageKey: body.storageKey,
      mimeType: body.mimeType,
      sizeBytes: body.size,
      pageCount,
    });
    // Auto-price the file immediately if page count is available.
    // This ensures the customer sees a non-zero price right after upload,
    // instead of ₹0.00 until they manually change print settings.
    let pricePaise = 0;
    if (pageCount && pageCount > 0) {
      try {
        const shop = await repos.shops.findById(order.shopId);
        const pricingConfig = shop?.pricingConfig ?? createDefaultPricingConfig();
        const pricingInput: PricingInput = {
          pages: pageCount,
          copies: 1,
          colorMode: 'bw',
          paperSize: 'a4',
          duplex: false,
          shopPricingConfig: pricingConfig,
        };
        const result = priceFile(pricingInput);
        pricePaise = result.totalPaise;
        await repos.files.update(file.id, { pricePaise });
      } catch (e) {
        // If auto-pricing fails, leave at 0 — the PATCH route will price it.
        console.error('[files] auto-price failed:', e instanceof Error ? e.message : String(e));
      }
    } else if (needsReview) {
      // For files where page count couldn't be determined, set a default
      // page count of 1 and price it, so the customer sees a non-zero price.
      // The shopkeeper can correct the page count later via the page-count endpoint.
      try {
        const shop = await repos.shops.findById(order.shopId);
        const pricingConfig = shop?.pricingConfig ?? createDefaultPricingConfig();
        const pricingInput: PricingInput = {
          pages: 1,
          copies: 1,
          colorMode: 'bw',
          paperSize: 'a4',
          duplex: false,
          shopPricingConfig: pricingConfig,
        };
        const result = priceFile(pricingInput);
        pricePaise = result.totalPaise;
        // Set a default pageCount of 1 AND the price, but keep needs_review status
        // so the shopkeeper knows they need to verify the page count.
        await repos.files.update(file.id, { pricePaise, pageCount: 1 });
      } catch (e) {
        console.error('[files] auto-price (needs_review) failed:', e instanceof Error ? e.message : String(e));
      }
    }

    if (needsReview) {
      // Keep needs_review status (shopkeeper should still verify) but the file
      // now has a price based on 1 page default.
      await repos.files.update(file.id, { status: 'needs_review' });
    }

    // Recalculate order total
    const siblings = await repos.files.findByOrder(order.id);
    const orderTotal = siblings.reduce((acc, f) => acc + f.pricePaise, 0);
    await repos.orders.update(order.id, { totalAmountPaise: orderTotal });

    await repos.audit.log({
      shopId: order.shopId,
      userId: null,
      action: 'file.upload',
      entityType: 'file',
      entityId: file.id,
      metadata: { filename: body.filename, size: body.size, pageCount, needsReview },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      fileId: file.id,
      pageCount: file.pageCount,
      pricePaise,
      status: needsReview ? 'needs_review' : file.status,
      needsReview,
    });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  }),
);

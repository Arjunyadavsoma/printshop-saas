import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { parsePageCount } from '@/lib/services/parse-page-count';
import { priceFileFromRecord, recalcOrderTotal } from '@/lib/pricing/price-file';
import type { PageCountSource } from '@platform/core/domain';

const ConfirmFileSchema = z.object({
  fileId: z.string().uuid(),
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().int().positive(),
});

/** POST /api/v1/orders/:id/files — confirm an upload, parse + price.
 *
 * Flow:
 *  1. Verify the object landed in storage (HEAD + size match).
 *  2. Fetch bytes via `storage.getBytes()` (works on R2, S3, Supabase, InMemory).
 *  3. Parse the page count (pdf-lib for PDF, JSZip for DOCX/PPTX/XLSX, 1 for
 *     images).
 *  4. If the count was auto-extracted → `pageCountSource='auto_extracted'`,
 *     price the file immediately using the shop's config, status='pending'.
 *  5. If extraction failed (legacy .doc, corrupted PDF, etc.) →
 *     `pageCountSource='placeholder'`, pageCount=null, status='needs_review',
 *     pricePaise=0. The customer or shopkeeper must set the count before
 *     checkout. A placeholder NEVER generates a bill.
 *
 * SEC-001: behind withOrderAccess — caller must present the order's
 * `customerToken` before any upload confirmation runs. */
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
    //    namespace (`shops/<shopId>/orders/<orderId>/<fileId>`). This blocks
    //    cross-order and cross-shop namespace attacks. ──
    const expectedPrefix = `shops/${order.shopId}/orders/${order.id}/`;
    if (!body.storageKey.startsWith(expectedPrefix)) {
      throw new ValidationError(
        `storageKey must be in this order's namespace (expected prefix "${expectedPrefix}")`,
        { receivedPrefix: body.storageKey.split('/').slice(0, 4).join('/') + '/' },
      );
    }

    // Verify the object actually landed in storage (HEAD + size match).
    const head = await storage.head(body.storageKey);
    if (!head) throw new ValidationError('File not found in storage — did the upload complete?');
    if (head.size !== body.size) {
      throw new ValidationError(`Size mismatch: declared ${body.size}, stored ${head.size}`);
    }

    // ── Page-count extraction ──
    // Fetch the raw bytes so the parser can read the document structure.
    // All production adapters (R2, S3, Supabase) implement getBytes; the
    // InMemory test adapter does too. If an adapter lacks getBytes, bytes
    // are null and the file is marked placeholder (needs manual entry).
    const hasGetBytes =
      typeof (storage as unknown as { getBytes?: unknown }).getBytes === 'function';
    const bytes = hasGetBytes
      ? await (storage as unknown as {
          getBytes: (k: string) => Promise<{ bytes: Uint8Array } | null>;
        })
          .getBytes(body.storageKey)
          .then((r) => r?.bytes ?? null)
      : null;

    const parsedPageCount = await parsePageCount(body.mimeType, bytes);

    let pageCount: number | null;
    let pageCountSource: PageCountSource;
    let status: 'pending' | 'needs_review';
    let processingError: string | null = null;

    if (parsedPageCount !== null) {
      pageCount = parsedPageCount;
      pageCountSource = 'auto_extracted';
      status = 'pending';
    } else {
      // Extraction failed — legacy .doc, corrupted PDF, encrypted doc, etc.
      // Mark as placeholder. The file CANNOT be priced or checked out until
      // a customer or shopkeeper supplies a page count.
      pageCount = null;
      pageCountSource = 'placeholder';
      status = 'needs_review';
      processingError = 'Page count could not be auto-extracted. Enter the page count manually.';
    }

    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    // Create the file record with the extracted/defaulted page count + source.
    const file = await repos.files.create({
      orderId: order.id,
      originalFilename: body.filename,
      storageKey: body.storageKey,
      mimeType: body.mimeType,
      sizeBytes: body.size,
      pageCount,
      pageCountSource,
      status,
      processingError,
    });

    // Price the file ONLY if the page count was auto-extracted (trustworthy).
    // Placeholder files stay at pricePaise=0 and status='needs_review'.
    let pricePaise = 0;
    if (pageCountSource === 'auto_extracted' && pageCount !== null) {
      try {
        const priced = priceFileFromRecord(
          { ...file, pageCount, pageCountSource },
          shop,
        );
        pricePaise = priced.totalPaise;
        await repos.files.update(file.id, { pricePaise });
      } catch (pricingErr) {
        // Pricing failed (missing config, invalid range) — mark the file
        // so the UI can explain. Don't crash the upload.
        const msg = pricingErr instanceof Error ? pricingErr.message : 'Pricing failed';
        await repos.files.update(file.id, {
          status: 'needs_review',
          processingError: msg,
          pageCountSource: 'placeholder',
        });
      }
    }

    // Recalculate the order total from all file prices.
    const orderTotal = await recalcOrderTotal(order.id);

    await repos.audit.log({
      shopId: order.shopId,
      userId: null,
      action: 'file.upload',
      entityType: 'file',
      entityId: file.id,
      metadata: {
        filename: body.filename,
        size: body.size,
        pageCount,
        pageCountSource,
        pricePaise,
        needsReview: status === 'needs_review',
      },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      fileId: file.id,
      pageCount: file.pageCount,
      pageCountSource: file.pageCountSource,
      pageCountEstimated: pageCountSource === 'placeholder',
      status: file.status,
      pricePaise,
      processingError: file.processingError,
      orderTotalPaise: orderTotal,
      needsReview: status === 'needs_review',
    });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  }),
);

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { parsePageCount } from '@/lib/services/parse-page-count';

const ConfirmFileSchema = z.object({
  fileId: z.string().uuid(),
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().int().positive(),
});

/** POST /api/v1/orders/:id/files — confirm an upload, parse page count. */
export const POST = withRateLimit<{ id: string }>('confirm-file', 30, 60, async (req, ctx) => {
  try {
    const { id } = await ctx.params;
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
    if (order.status !== 'awaiting_payment') {
      throw new ValidationError(`Order in status '${order.status}' cannot accept files`);
    }

    const body = ConfirmFileSchema.parse(await req.json());
    const storage = getContainer().storage;

    // Verify the object actually landed in storage (HEAD).
    const head = await storage.head(body.storageKey);
    if (!head) throw new ValidationError('File not found in storage — did the upload complete?');
    if (head.size !== body.size) {
      throw new ValidationError(`Size mismatch: declared ${body.size}, stored ${head.size}`);
    }

    // Parse page count — pdf-lib for PDFs, 1 for images, null for Office.
    const hasGetBytes = typeof (storage as { getBytes?: unknown }).getBytes === 'function';
    const bytes = hasGetBytes
      ? await (storage as { getBytes: (k: string) => Promise<{ bytes: Uint8Array } | null> }).getBytes(body.storageKey).then((r) => r?.bytes ?? null)
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
    if (needsReview) {
      await repos.files.update(file.id, { status: 'needs_review' });
    }

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
      status: needsReview ? 'needs_review' : file.status,
      needsReview,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

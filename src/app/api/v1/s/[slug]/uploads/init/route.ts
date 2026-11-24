import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { createSession, MAX_FILE_BYTES } from '@/lib/pipeline/upload-sessions';
import { detectKind } from '@/lib/pipeline/normalize';
import { NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * POST /api/v1/s/[slug]/uploads/init — start a resumable upload.
 * Creates (or reuses) the customer's DRAFT order and a file row, and hands
 * back an upload session the client streams chunks into.
 */
const BodySchema = z.object({
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  /** Optional: attach to an existing draft order (multi-file order). */
  orderId: z.string().uuid().optional(),
  orderToken: z.string().min(8).optional(),
});

export const POST = withRateLimit('uploads-init', 30, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    const { slug } = await ctx.params;
    const body = BodySchema.parse(await req.json());

    const shop = await getContainer().db.findOne<{ id: string; name: string; isOpen: boolean; acceptingOrders: boolean; openingHours: unknown }>('shop', { slug });
    if (!shop) throw new NotFoundError('Shop not found');
    // Default to open/accepting when fields are missing (in-memory adapter
    // doesn't apply Prisma @default(true) — be defensive so demo shops work).
    const shopIsOpen = shop.isOpen ?? true;
    const shopAccepting = shop.acceptingOrders ?? true;
    if (!shopIsOpen || !shopAccepting) {
      throw new ValidationError('This shop is not accepting orders right now. Check the opening hours and try again later.');
    }
    if (body.sizeBytes > MAX_FILE_BYTES) {
      throw new ValidationError(`File is too large. The limit is 50 MB per file.`);
    }
    // AUDIT P0-2: gate the file type at session start — same supported set
    // as the normalize pipeline (its own UNSUPPORTED_TYPE message). Without
    // this, an unsupported file reached the queue in dev, where the
    // simulate fallback marked it "Ready" with an invented page count.
    if (detectKind(body.mimeType, body.filename) === 'unsupported') {
      throw new ValidationError('Unsupported file type. Supported: PDF, JPG, PNG, WEBP, HEIC, DOCX, DOC, PPTX, XLSX.');
    }

    // Resolve or create the customer's draft order.
    let orderId: string;
    let orderToken: string;
    if (body.orderId && body.orderToken) {
      const order = await getContainer().db.findOne<{ id: string; customerToken: string; shopId: string; status: string }>('order', { id: body.orderId });
      if (!order || order.shopId !== shop.id || order.customerToken !== body.orderToken) {
        throw new NotFoundError('Order not found');
      }
      if (order.status !== 'draft') throw new ValidationError('Files can only be added while the order is a draft.');
      orderId = order.id;
      orderToken = order.customerToken;
    } else {
      // customerToken MUST be unguessable (it IS the credential) — 128-bit hex
      // (brief §Auth: "each order has an unguessable order token (128-bit)").
      const order = await repos.orders.createWithUniqueToken(
        shop.id,
        {
          customerPhone: null,
          notes: null,
          regenerateCustomerToken: () =>
            crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
        },
        (c, a) => String(900 + c + a),
      );
      orderId = order.id;
      orderToken = order.customerToken;
      await getContainer().db.update('order', { id: orderId }, { status: 'draft' });
      await repos.orderEvents.append(orderId, { type: 'draft_created', actorType: 'customer', actorId: null, data: { via: 'upload-init' } });
    }

    // Order total size guard is checked at chunk-append + complete time.
    // P9-Security §3: filename sanitization — strip every byte that is NOT
    // a word char / dot / dash / parens / space (replaces path separators,
    // NUL bytes, shell metacharacters with `_`), then strip leading dots
    // (defends against hidden-file + traversal persistence) and collapse
    // dot-runs so a `....pdf` can't smuggle a `..` past a downstream
    // storage layer that interprets it as parent-dir. Cap at 180 chars so
    // a pathologically long name doesn't blow up storage key limits.
    const sanitized = body.filename
      .replace(/[^\w.\-() ]+/g, '_')
      .replace(/^\.+/g, '')
      .replace(/\.{2,}/g, '.')
      .slice(0, 180);
    const file = await repos.files.create({
      orderId,
      originalFilename: sanitized,
      storageKey: '', // set at complete (needs the fileId); placeholder now
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      pageCount: null,
      status: 'uploaded',
    });
    const storageKey = `shops/${shop.id}/orders/${orderId}/orig/${file.id}_${sanitized}`;
    await getContainer().db.update('printFile', { id: file.id }, { storageKey });

    const uploadId = await createSession({
      fileId: file.id,
      orderId,
      orderToken,
      shopId: shop.id,
      filename: sanitized,
      mimeType: body.mimeType,
      declaredSize: body.sizeBytes,
    });

    return ok({
      orderId,
      orderToken,
      fileId: file.id,
      uploadId,
      chunkSize: 2 * 1024 * 1024,
      status: file.status,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

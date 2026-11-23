import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { ValidationError } from '@platform/core/errors';

/**
 * POST /api/v1/shop/walkin — create a walk-in order from the shopkeeper's phone.
 *
 * The shopkeeper uploads files from their phone (PDF, images, DOCX), the server
 * creates a walk-in order with the same structure as an online order but marked
 * as walk-in. The creating phone is the executor.
 *
 * Shop setting decides whether walk-ins are billed (shop.walkinBilled, default false).
 *
 * Body:
 *   { files: [{ filename, mimeType, size, storageKey }], customerName?, customerPhone?, note? }
 *
 * The files are already uploaded to storage by the phone (via the upload-url
 * flow or direct upload). This endpoint creates the order + files + specs.
 */

const WalkinFileSchema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  storageKey: z.string().min(1).max(500),
});

const WalkinSchema = z.object({
  files: z.array(WalkinFileSchema).min(1).max(20),
  customerName: z.string().max(100).optional(),
  customerPhone: z.string().max(20).optional(),
  note: z.string().max(500).optional(),
});

export const POST = withAuth(async (req, _ctx, { user, shopId }) => {
  try {
    const body = WalkinSchema.parse(await req.json());
    const container = getContainer();
    const db = container.db;

    // Create a walk-in order (status: queued — no payment needed unless billed)
    const orderId = crypto.randomUUID();
    const orderToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

    await db.insert('Order', {
      id: orderId,
      shopId,
      customerToken: orderToken,
      status: 'queued', // walk-in skips payment
      totalAmountPaise: 0, // will be computed if billed
      currency: 'INR',
      paymentProvider: null,
      paymentTxnId: null,
      paymentUtr: null,
      paidAt: null,
      customerPhone: body.customerPhone ?? null,
      notes: body.note ?? null,
      tokenNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create files
    for (const file of body.files) {
      const fileId = crypto.randomUUID();
      await db.insert('PrintFile', {
        id: fileId,
        orderId,
        originalFilename: file.filename,
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        pageCount: null, // will be set by processing
        pageCountSource: 'placeholder',
        copies: 1,
        colorMode: 'bw',
        pageRange: null,
        paperSize: 'a4',
        duplex: false,
        pricePaise: 0,
        status: 'pending',
        processingError: null,
        printedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Audit log
    void repos.audit.log({
      shopId,
      userId: user.id,
      action: 'walkin.created',
      entityType: 'order',
      entityId: orderId,
      metadata: { fileCount: body.files.length, customerName: body.customerName },
      ip: req.headers.get('x-forwarded-for') ?? null,
    }).catch(() => {});

    return ok({
      orderId,
      orderToken,
      fileCount: body.files.length,
      message: 'Walk-in order created. Files will be processed for printing.',
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner', 'staff']);

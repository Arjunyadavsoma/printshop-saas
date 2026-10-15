import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { storageKey, validateUploadRequest, type FileUploadRequest } from '@platform/utils';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from '@platform/core/domain';

const UploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().int().positive(),
});

/** POST /api/v1/orders/:id/files/upload-url — mint a presigned PUT URL. */
export const POST = withRateLimit<{ id: string }>('upload-url', 30, 60, async (req, ctx) => {
  try {
    const { id } = await ctx.params;
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
    if (order.status !== 'awaiting_payment') {
      throw new ValidationError(`Order in status '${order.status}' cannot accept files`);
    }

    const body = UploadUrlSchema.parse(await req.json());
    const req_: FileUploadRequest = { filename: body.filename, mimeType: body.mimeType, size: body.size };
    const err = validateUploadRequest(req_);
    if (err) throw new ValidationError(err);
    if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(body.mimeType)) {
      throw new ValidationError(`Unsupported file type: ${body.mimeType}`);
    }
    if (body.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new ValidationError(`File too large (max ${MAX_UPLOAD_SIZE_BYTES} bytes)`);
    }

    const fileId = crypto.randomUUID();
    const key = storageKey(order.shopId, order.id, fileId);
    const uploadUrl = await getContainer().storage.getPresignedUploadUrl({
      key,
      contentType: body.mimeType,
      contentLength: body.size,
      expiresInSeconds: 300,
    });

    return ok({ fileId, storageKey: key, uploadUrl, expiresInSeconds: 300 });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

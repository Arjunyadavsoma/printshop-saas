import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { finishSession, getSession, abandonSession, MAX_FILE_BYTES, MAX_ORDER_BYTES } from '@/lib/pipeline/upload-sessions';
import { processUpload } from '@/lib/pipeline/process';
import { sniffKind, detectKind, sha256Hex, NormalizeError } from '@/lib/pipeline/normalize';
import { NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * POST /api/v1/s/[slug]/uploads/complete — assemble the chunks, validate
 * (size + magic bytes vs declared type), store the original via the
 * StorageProvider, then run the normalization pipeline (convert → color
 * suggestion → thumbnails). `wait=true` processes inline (tests / small
 * files); the default kicks processing off in the background and the UI
 * polls the file-status endpoint through CONVERTING.
 */
const BodySchema = z.object({
  uploadId: z.string().uuid(),
  wait: z.boolean().optional(),
});

export const POST = withRateLimit('uploads-complete', 60, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    await ctx.params;
    const body = BodySchema.parse(await req.json());
    const session = getSession(body.uploadId);
    if (!session) throw new NotFoundError('Upload session not found or expired — restart the upload.');

    const finished = await finishSession(body.uploadId);
    if (!finished) throw new NotFoundError('Upload session not found');
    const { bytes, session: s } = finished;

    if (bytes.length === 0) throw new ValidationError('No data was uploaded.');
    if (bytes.length > MAX_FILE_BYTES) {
      throw new ValidationError('File is larger than the 50 MB limit.');
    }
    // order-level size guard
    const siblings = await repos.files.findByOrder(s.orderId);
    const total = siblings.reduce((sum, f) => sum + (f.id === s.fileId ? 0 : f.sizeBytes), 0) + bytes.length;
    if (total > MAX_ORDER_BYTES) {
      abandonSession(body.uploadId);
      throw new ValidationError('This order exceeds the 200 MB limit. Split it into more than one order.');
    }

    // magic bytes vs declared type
    const sniffed = sniffKind(bytes);
    const declared = detectKind(s.mimeType, s.filename);
    if (declared === 'office' && sniffed !== 'zip') {
      throw new NormalizeError('TYPE_MISMATCH', 'The file content does not match its extension. Upload the real .docx/.pptx/.xlsx file.');
    }
    if (declared === 'pdf' && sniffed !== 'pdf') {
      throw new NormalizeError('TYPE_MISMATCH', 'This is not a PDF file (content check failed).');
    }
    if (declared === 'image' && !['image', 'heic'].includes(sniffed)) {
      throw new NormalizeError('TYPE_MISMATCH', 'This is not an image file (content check failed).');
    }
    if (sniffed === 'unknown') {
      throw new NormalizeError('UNSUPPORTED_TYPE', 'Unsupported file type. Upload a PDF, image, or Office document.');
    }

    const originalKey = `shops/${s.shopId}/orders/${s.orderId}/orig/${s.fileId}_${s.filename}`;
    const storage = getContainer().storage;
    if (!storage.put) {
      throw new NormalizeError('STORAGE_PUT_UNAVAILABLE', 'Storage adapter does not support server-side writes.');
    }
    await storage.put(originalKey, bytes, s.mimeType);
    await getContainer().db.update('printFile', { id: s.fileId }, {
      sizeBytes: bytes.length,
      checksum: sha256Hex(bytes),
      status: 'converting',
    });

    const run = processUpload(s.fileId);
    if (body.wait) {
      const result = await run;
      const file = await repos.files.findById(s.fileId);
      return ok({ fileId: s.fileId, status: result.status, failReason: result.failReason ?? null, file });
    }
    // background — surface failures through the status endpoint
    run.catch(() => {});
    return ok({ fileId: s.fileId, status: 'converting' });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

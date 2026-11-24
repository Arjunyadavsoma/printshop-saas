import { NextRequest, after } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { finishSession, getSession, abandonSession, MAX_FILE_BYTES, MAX_ORDER_BYTES } from '@/lib/pipeline/upload-sessions';
import { processUpload } from '@/lib/pipeline/process';
import { sniffKind, detectKind, sha256Hex, NormalizeError } from '@/lib/pipeline/normalize';
import { AppError, NotFoundError, ValidationError } from '@platform/core/errors';

/**
 * POST /api/v1/s/[slug]/uploads/complete — assemble the chunks, validate
 * (size + magic bytes vs declared type), store the original via the
 * StorageProvider, then run the normalization pipeline (convert → color
 * suggestion → thumbnails). `wait=true` processes inline (tests / small
 * files); the default kicks processing off in the background and the UI
 * polls the file-status endpoint through CONVERTING.
 *
 * P8.7: `finishSession` now verifies the assembled bytes match the declared
 * size (catches a truncated final chunk or a missing middle chunk before
 * the pipeline runs). A mismatch returns 409 `SIZE_MISMATCH` — the client
 * must re-upload the missing chunks (via GET /status to find the gaps).
 */
const BodySchema = z.object({
  uploadId: z.string().uuid(),
  wait: z.boolean().optional(),
});

export const POST = withRateLimit('uploads-complete', 60, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    await ctx.params;
    const body = BodySchema.parse(await req.json());
    const session = await getSession(body.uploadId);
    if (!session) throw new NotFoundError('Upload session not found or expired — restart the upload.');
    if (session.status !== 'active') {
      throw new NotFoundError('Upload session has expired — restart the upload.');
    }

    let finished: Awaited<ReturnType<typeof finishSession>>;
    try {
      finished = await finishSession(body.uploadId);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.startsWith('SIZE_MISMATCH') || msg.startsWith('MISSING_CHUNK') || msg.startsWith('ASSEMBLED_SIZE_MISMATCH')) {
        // The client can query GET /status to find the missing chunks + re-upload them.
        return fail(new AppError(
          `Upload incomplete — ${msg}. Query GET /api/v1/s/[slug]/uploads/status?uploadId=${body.uploadId} for the missing chunk indices.`,
          'UPLOAD_INCOMPLETE',
          409,
        ));
      }
      if (msg === 'UPLOAD_EXPIRED') {
        return fail(new AppError('Upload session has expired — restart the upload.', 'UPLOAD_EXPIRED', 410));
      }
      throw cause;
    }
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
      await abandonSession(body.uploadId);
      throw new ValidationError('This order exceeds the 200 MB limit. Split it into more than one order.');
    }

    // magic bytes vs declared type — enforced in EVERY environment. The
    // previous dev relaxation (`DATABASE_PROVIDER=memory`/`NODE_ENV!=='production'`
    // skipped the check) meant demo/test uploads could mismatch their
    // declared type; that is exactly the class of dishonest validation
    // fixed in BUG-LIST P0-2. Demo uploads should upload real files.
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
    // P9-Security §3: strip EXIF / GPS metadata from stored images BEFORE
    // the original bytes land in cloud storage. A phone-camera JPEG carries
    // the customer's home/office GPS coordinates in the EXIF IFD; without
    // this strip step, those coordinates persist in the stored ORIGINAL
    // and leak to anyone with storage access (shop staff, backups, leaks).
    // PNGs without EXIF round-trip unchanged. PDFs and Office docs are not
    // touched here (PDFs may carry XMP metadata but no GPS by default;
    // Office docs are converted to PDF by soffice which strips metadata).
    // The strip is best-effort: if sharp is unavailable or the image is
    // malformed, we fall back to storing the original bytes (the pipeline's
    // normalize step will surface a CORRUPT_IMAGE failure for malformed
    // inputs; a missing sharp install is a deployment issue, not a security
    // regression on its own).
    let bytesToStore = bytes;
    if (sniffed === 'image' || sniffed === 'heic') {
      try {
        bytesToStore = await stripImageExif(bytes);
      } catch {
        // Sharp unavailable or the bytes are a corrupt image — keep the
        // original bytes; the downstream normalize step will mark the file
        // FAILED if the bytes are actually corrupt. The strip is a privacy
        // enhancement, not a correctness gate.
        bytesToStore = bytes;
      }
    }
    await storage.put(originalKey, bytesToStore, s.mimeType);
    await getContainer().db.update('printFile', { id: s.fileId }, {
      sizeBytes: bytesToStore.length,
      checksum: sha256Hex(bytesToStore),
      status: 'converting',
    });

    const run = processUpload(s.fileId);
    if (body.wait) {
      const result = await run;
      const file = await repos.files.findById(s.fileId);
      return ok({ fileId: s.fileId, status: result.status, failReason: result.failReason ?? null, file });
    }
    // background — surface failures through the status endpoint. Use
    // after() so Vercel keeps the function alive until processing finishes;
    // a bare unawaited promise can be frozen after the response, leaving
    // the file stuck in 'converting' forever.
    after(() => run.catch(() => {}));
    return ok({ fileId: s.fileId, status: 'converting' });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

/**
 * Strip EXIF / GPS metadata from an image. Re-encodes the image through
 * sharp without `withMetadata()` so the output carries no EXIF, no ICC, no
 * XMP — only the pixels. Honours EXIF orientation by calling `.rotate()`
 * (so a portrait photo rotated 90° stays portrait after stripping).
 *
 * Falls back to returning the original bytes if sharp cannot decode the
 * input (the caller — `complete/route.ts` — handles this case).
 */
async function stripImageExif(bytes: Uint8Array): Promise<Uint8Array> {
  type SharpFn = typeof import('sharp');
  let sharp: SharpFn;
  try {
    const mod = await import('sharp');
    sharp = ((mod as unknown as { default?: SharpFn }).default ?? (mod as unknown as SharpFn));
  } catch {
    throw new Error('IMAGE_PIPE_UNAVAILABLE');
  }
  // Read the input format so we re-encode to the same format (PNG→PNG,
  // JPEG→JPEG, WEBP→WEBP). Falling back to JPEG for unknown formats.
  const meta = await sharp(bytes).metadata();
  const fmt = (meta.format ?? 'jpeg') as 'png' | 'jpeg' | 'webp';
  const out = await sharp(bytes, { failOn: 'error' })
    .rotate() // apply EXIF orientation to the pixel data, then drop the tag
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    [fmt]({})
    .toBuffer();
  return new Uint8Array(out);
}

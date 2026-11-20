import { type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
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

// ── SEC-C6: magic-byte sniffing helpers ──────────────────────────────────
//
// These are pure functions over the raw bytes — no I/O, no allocations
// beyond a tiny header read. They run BEFORE parsePageCount so a malformed
// or malicious upload is rejected before any expensive parser work.
//
// The detector returns a string family (`'pdf' | 'zip' | 'jpeg' | 'png' |
// 'gif' | 'webp' | 'bmp' | 'tiff' | 'unknown'`). The matcher compares the
// family against the declared MIME type — the OOXML formats (DOCX/PPTX/
// XLSX) all share the ZIP family, so we accept any ZIP-family declaration
// for those.

type MagicFamily = 'pdf' | 'zip' | 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'unknown';

/** Map a declared MIME type to the magic family it must have. */
const MIME_TO_FAMILY: Record<string, MagicFamily> = {
  'application/pdf': 'pdf',
  // OOXML formats are ZIP containers.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
  'application/zip': 'zip',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

/** Sniff the magic-byte family from the first few bytes of a buffer. */
export function detectMagicFamily(bytes: Uint8Array): MagicFamily {
  if (bytes.length < 4) return 'unknown';
  const b = bytes;
  // PDF: `%PDF` (0x25 0x50 0x44 0x46)
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  // ZIP / OOXML: `PK` (0x50 0x4B)
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';
  // JPEG: 0xFF 0xD8 0xFF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  // PNG: 0x89 0x50 0x4E 0x47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  // GIF: `GIF8`
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  // BMP: `BM`
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  // TIFF: `II*\x00` (little-endian) or `MM\x00*` (big-endian)
  const leTiff =
    b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00;
  const beTiff =
    b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a;
  if (leTiff || beTiff) return 'tiff';
  // WebP: `RIFF`....`WEBP` (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    bytes.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'webp';
  return 'unknown';
}

/** True if the declared MIME type is consistent with the sniffed bytes.
 *  Unknown MIME types (not in MIME_TO_FAMILY) bypass the check — they're
 *  either legacy formats (DOC, PPT, XLS) or text-like formats that have
 *  no magic bytes, and parsePageCount will already mark them needs_review. */
export function magicBytesMatchMime(bytes: Uint8Array, declaredMime: string): boolean {
  const expected = MIME_TO_FAMILY[declaredMime];
  if (!expected) return true; // unsupported/legacy MIME → let parser decide
  const detected = detectMagicFamily(bytes);
  if (detected === 'unknown') return false; // bytes don't look like anything we recognize
  return detected === expected;
}

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

    // ── Idempotency: if a file with this storageKey already exists for this
    // order, return it instead of creating a duplicate. This handles browser
    // retries (network timeout after the server already processed the
    // confirmation). Without this, a retry would create a second file record
    // and double-count the order total. ──
    const existing = await repos.files.findByOrder(order.id);
    const existingFile = existing.find((f) => f.storageKey === body.storageKey);
    if (existingFile) {
      const orderTotal = await recalcOrderTotal(order.id);
      return ok({
        fileId: existingFile.id,
        pageCount: existingFile.pageCount,
        pageCountSource: existingFile.pageCountSource,
        pageCountEstimated: existingFile.pageCountSource === 'placeholder',
        status: existingFile.status,
        pricePaise: existingFile.pricePaise,
        processingError: existingFile.processingError,
        orderTotalPaise: orderTotal,
        needsReview: existingFile.status === 'needs_review',
        idempotent: true,
      });
    }

    // ── Page-count extraction ──
    // Fetch the raw bytes so the parser can read the document structure.
    // The StorageAdapter interface defines `getBytes` as an optional method;
    // all production adapters (R2, S3, Supabase) implement it. If absent,
    // bytes are null and the file is marked placeholder (needs manual entry).
    const bytes = storage.getBytes
      ? (await storage.getBytes(body.storageKey))?.bytes ?? null
      : null;

    // ── B-010: server-side SHA-256 of the stored bytes ──
    // Computed from the SAME bytes the parser reads, so the agent pending-jobs
    // payload can hand it to the companion (pdfSha256) for pre-print content
    // verification, and the receipt path can audit the agent's checksum
    // against it. Null when the storage adapter can't expose bytes (hashing
    // then falls back to trust-on-first-use on the agent's receipt).
    const sha256 = bytes
      ? createHash('sha256').update(bytes).digest('hex')
      : null;

    // ── SEC-C6: magic-byte sniffing ─────────────────────────────────────
    // The client sends a `mimeType` (from the browser's File.type) which is
    // trivially spoofable — an attacker can rename `evil.exe` to `evil.pdf`
    // and the browser will happily send `Content-Type: application/pdf`.
    // Without a server-side content check, the renamed executable would be
    // stored as a "PDF", and:
    //   - the parsePageCount call would either crash (pdf-lib throws on
    //     non-PDF input — caught, returns null → needs_review, harmless)
    //     OR succeed silently (e.g. a file that happens to start with `%PDF`
    //     but is otherwise malicious — extremely unlikely but possible).
    //   - the file would be served to the shopkeeper's print agent / browser
    //     download with `Content-Type: application/pdf`, potentially
    //     triggering a different code path in the agent or browser.
    //
    // The fix: inspect the first few bytes (the "magic bytes") of the
    // fetched content and confirm they match what the declared MIME type
    // claims. If the declared type is `application/pdf` but the bytes
    // don't start with `%PDF`, reject with a ValidationError BEFORE
    // attempting to parse the page count. This blocks renamed-executable
    // uploads at the confirm endpoint (storage is bytewise identical to
    // what was uploaded via the presigned URL — we're checking the bytes
    // that are actually in storage, not what the client claims to have
    // sent).
    //
    // The `sniffMagic` helper returns the MIME family implied by the bytes
    // (e.g. `pdf`, `zip`, `jpeg`, `png`, …). We compare it against the
    // declared MIME: a ZIP family declared as DOCX/PPTX/XLSX is accepted
    // (they're all ZIP containers); anything else must match exactly.
    if (bytes && !magicBytesMatchMime(bytes, body.mimeType)) {
      throw new ValidationError(
        'File content does not match declared type — the uploaded bytes are not what the filename/MIME claim. Re-save the file from its source application and re-upload.',
        {
          declaredMime: body.mimeType,
          detectedMagic: detectMagicFamily(bytes),
          filename: body.filename,
        },
      );
    }

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
      sha256,
    });

    // `finalFile` tracks the PERSISTED record after every update. The API
    // response MUST return `finalFile`, not the stale `file` variable —
    // otherwise the client sees pre-update status/source/price values that
    // don't match the database (the stale-response bug).
    let finalFile = file;
    let pricePaise = 0;

    // Price the file ONLY if the page count was auto-extracted (trustworthy).
    // Placeholder files stay at pricePaise=0 and status='needs_review'.
    if (pageCountSource === 'auto_extracted' && pageCount !== null) {
      try {
        const priced = priceFileFromRecord(
          { ...file, pageCount, pageCountSource },
          shop,
        );
        pricePaise = priced.totalPaise;
        finalFile = await repos.files.update(file.id, { pricePaise });
      } catch (pricingErr) {
        // Pricing failed (missing config, invalid range) — mark the file
        // so the UI can explain. Don't crash the upload. Capture the
        // updated record so the response reflects the persisted state.
        const msg = pricingErr instanceof Error ? pricingErr.message : 'Pricing failed';
        finalFile = await repos.files.update(file.id, {
          status: 'needs_review',
          processingError: msg,
          pageCountSource: 'placeholder',
          pricePaise: 0,
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
      entityId: finalFile.id,
      metadata: {
        filename: body.filename,
        size: body.size,
        pageCount: finalFile.pageCount,
        pageCountSource: finalFile.pageCountSource,
        pricePaise: finalFile.pricePaise,
        needsReview: finalFile.status === 'needs_review',
      },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    // Return the FINAL persisted record — never the stale `file` variable.
    return ok({
      fileId: finalFile.id,
      pageCount: finalFile.pageCount,
      pageCountSource: finalFile.pageCountSource,
      pageCountEstimated: finalFile.pageCountSource === 'placeholder',
      status: finalFile.status,
      pricePaise: finalFile.pricePaise,
      processingError: finalFile.processingError,
      orderTotalPaise: orderTotal,
      needsReview: finalFile.status === 'needs_review',
    });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  }),
);

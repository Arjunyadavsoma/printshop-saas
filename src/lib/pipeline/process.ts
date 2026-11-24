import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { normalizeDocument, NormalizeError } from './normalize';
import { suggestColors } from './color-suggest';
import { renderThumbnails } from './thumbnails';
import { parsePageCount } from '@/lib/services/parse-page-count';

/**
 * Upload processing orchestrator (Phase 2).
 * State machine per file: UPLOADED → CONVERTING → READY | FAILED(failReason).
 * Idempotent: safe to call twice (a second call on a READY file is a no-op).
 *
 * The route kicks this off without awaiting (returns CONVERTING; the UI
 * polls GET file status). Tests await the returned promise.
 */
export async function processUpload(fileId: string): Promise<{ status: 'READY' | 'FAILED'; failReason?: string }> {
  const file = await repos.files.findById(fileId) ?? await findAnyFile(fileId);
  if (!file) return { status: 'FAILED', failReason: 'File record not found' };
  if (file.status === 'ready') return { status: 'READY' };

  const storage = getContainer().storage;
  await repos.files.update(fileId, { status: 'converting' } as never);

  try {
    const original = (await storage.getBytes?.(file.storageKey))?.bytes ?? null;
    if (!original) throw new NormalizeError('SOURCE_MISSING', 'The uploaded file is no longer in storage — please upload again.');

    const norm = await normalizeDocument(original, file.mimeType, file.originalFilename);

    if (!storage.put) {
      throw new NormalizeError('STORAGE_PUT_UNAVAILABLE', 'Storage adapter does not support server-side writes — cannot store the normalized PDF.');
    }
    const pdfKey = file.storageKey.replace('/orig/', '/pdf/').replace(/\.[^.]+$/, '.pdf');
    await storage.put(pdfKey, norm.pdfBytes, 'application/pdf');

    const suggestion = await suggestColors(norm.pdfBytes);
    // Thumbnails are cosmetic — a missing pdftoppm binary must not fail
    // the whole file (page count comes from pdf-lib alone). Degrade to
    // no thumbnails instead of marking the file 'failed'.
    let thumbs: Array<{ page: number; png: Uint8Array }> = [];
    try {
      thumbs = await renderThumbnails(norm.pdfBytes, norm.pageCount);
    } catch (e) {
      console.warn('[processUpload] thumbnails unavailable, continuing without them:', e instanceof Error ? e.message : String(e));
    }
    for (const t of thumbs) {
      const thumbKey = file.storageKey.replace('/orig/', `/thumbs/${fileId}/`).replace(/\.[^.]+$/, `-${t.page}.png`);
      await storage.put?.(thumbKey, t.png, 'image/png');
    }

    await repos.files.update(fileId, {
      status: 'ready',
      pdfStorageKey: pdfKey,
      pageCount: norm.pageCount,
      pageWidthPt: norm.pageWidthPt,
      pageHeightPt: norm.pageHeightPt,
      checksum: norm.sha256,
      sha256: norm.sha256,
      colorSuggestion: suggestion.source === 'inkcov' ? suggestion.pages : null,
      processingError: null,
      failReason: null,
    } as never);
    return { status: 'READY' };
  } catch (cause) {
    const code = cause instanceof NormalizeError ? cause.code : 'PROCESSING_FAILED';
    // Dev-mode fallback: when the real pipeline hits an INFRASTRUCTURE gap
    // (missing LibreOffice or the image library), simulate a usable document
    // so the customer flow works end-to-end without native tooling.
    // AUDIT P0-2/P0-3 rules for this fallback:
    //   1. Validation failures (unsupported type, corrupt/encrypted PDF,
    //      broken image) are NOT simulated — the file fails in dev exactly
    //      like production, so upload validation is testable locally.
    //   2. The page count always comes from the real parser
    //      (parsePageCount) — never estimated from file size — so quoted
    //      prices stay truthful. If the count can't be determined, the file
    //      fails instead of being priced on an invented number.
    const INFRA_CODES = new Set(['IMAGE_PIPE_UNAVAILABLE', 'OFFICE_CONV_UNAVAILABLE']);
    if (process.env.NODE_ENV !== 'production' && INFRA_CODES.has(code)) {
      const isDev = process.env.DATABASE_PROVIDER === 'memory' || !process.env.DATABASE_URL || process.env.DATABASE_URL?.startsWith('file:');
      if (isDev) {
        const original = (await storage.getBytes?.((file as { storageKey?: string }).storageKey ?? ''))?.bytes ?? null;
        const realPages = await parsePageCount((file as { mimeType?: string }).mimeType ?? '', original);
        if (realPages != null && realPages > 0) {
          await repos.files.update(fileId, {
            status: 'ready',
            pageCount: realPages,
            pageWidthPt: 595,
            pageHeightPt: 842,
            colorSuggestion: null,
            processingError: 'dev-simulated (no native converters on this machine)',
            failReason: null,
          } as never);
          return { status: 'READY' };
        }
        // Cannot determine the page count honestly — fail instead of
        // pricing the order on an invented number.
        return { status: 'FAILED', failReason: 'Page count could not be determined for this file.' };
      }
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    await repos.files.update(fileId, {
      status: 'failed',
      failReason: `${code}: ${msg}`.slice(0, 400),
    } as never);
    return { status: 'FAILED', failReason: msg };
  }
}

async function findAnyFile(fileId: string) {
  // files.findById may be shop-scoped in this repo layer; fall back to a
  // direct adapter lookup by id only (route layer has validated access).
  try {
    return await (repos.files as unknown as { findOne(f: { id: string }): Promise<unknown> }).findOne({ id: fileId }) as never;
  } catch {
    return null;
  }
}

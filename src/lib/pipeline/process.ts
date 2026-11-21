import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { normalizeDocument, NormalizeError } from './normalize';
import { suggestColors } from './color-suggest';
import { renderThumbnails } from './thumbnails';

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
    const thumbs = await renderThumbnails(norm.pdfBytes, norm.pageCount);
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

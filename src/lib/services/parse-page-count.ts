import { PDFDocument } from 'pdf-lib';

/**
 * Parse the page count for an uploaded file. PDFs via pdf-lib; images count
 * as 1 page; Office formats return `null` (shopkeeper reviews).
 *
 * @returns the page count, or `null` when it can't be determined.
 */
export async function parsePageCount(
  mimeType: string,
  bytes: Uint8Array | null,
): Promise<number | null> {
  if (bytes && mimeType === 'application/pdf') {
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      return doc.getPageCount();
    } catch {
      return null; // needs_review
    }
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') return 1;
  // docx/doc — page count requires conversion; mark for review.
  return null;
}

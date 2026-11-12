import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

/**
 * Parse the page count for an uploaded file.
 *
 * Supported formats:
 *   - PDF: pdf-lib (exact page count)
 *   - DOCX: ZIP parsing of docProps/app.xml <Pages> element
 *   - Images: 1 page each
 *   - DOC/other Office: null (needs shopkeeper review — legacy binary format)
 *
 * @returns the page count, or `null` when it can't be determined.
 */
export async function parsePageCount(
  mimeType: string,
  bytes: Uint8Array | null,
): Promise<number | null> {
  if (!bytes || bytes.length === 0) return null;

  // PDF — exact page count via pdf-lib
  if (mimeType === 'application/pdf') {
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      return doc.getPageCount();
    } catch {
      return null; // corrupted/encrypted PDF → needs_review
    }
  }

  // DOCX — extract page count from docProps/app.xml
  // DOCX is a ZIP archive; the app.xml file contains a <Pages> element
  // set by the word processor that last saved the document.
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return await parseDocxPageCount(bytes);
  }

  // PPTX — extract slide count from ppt/presentation.xml
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return await parsePptxPageCount(bytes);
  }

  // XLSX — extract sheet count from xl/workbook.xml
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return await parseXlsxPageCount(bytes);
  }

  // Images — each image is 1 page
  if (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/gif' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/bmp' ||
    mimeType === 'image/tiff'
  ) {
    return 1;
  }

  // DOC, PPT, XLS (legacy binary formats), RTF, TXT, CSV, etc.
  // These require rendering/conversion to determine page count.
  // Mark for shopkeeper review.
  return null;
}

/**
 * Extract page count from a DOCX file by reading docProps/app.xml.
 *
 * The <Pages> element is set by Word when the document is saved.
 * If the element is missing or the file is malformed, return null.
 *
 * Note: DOCX pagination depends on fonts, margins, and printer settings.
 * The <Pages> value is the count from the last application that saved
 * the document — it may differ from the actual printed page count on
 * a different printer. This is the best available estimate without
 * rendering the document.
 */
async function parseDocxPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const appXmlFile = zip.file('docProps/app.xml');
    if (!appXmlFile) return null;

    const appXml = await appXmlFile.async('text');
    // Extract <Pages>N</Pages> from the XML
    const match = appXml.match(/<Pages>(\d+)<\/Pages>/);
    if (match) {
      const pages = parseInt(match[1], 10);
      return pages > 0 ? pages : null;
    }
    return null;
  } catch {
    return null; // malformed ZIP → needs_review
  }
}

/**
 * Extract slide count from a PPTX file by counting <p:sld> in presentation.xml.
 */
async function parsePptxPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const presentationXmlFile = zip.file('ppt/presentation.xml');
    if (!presentationXmlFile) return null;

    const xml = await presentationXmlFile.async('text');
    // Count <p:sldId> entries — each represents one slide
    const matches = xml.match(/<p:sldId\b/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

/**
 * Extract sheet count from an XLSX file by counting <sheet> in workbook.xml.
 */
async function parseXlsxPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const workbookXmlFile = zip.file('xl/workbook.xml');
    if (!workbookXmlFile) return null;

    const xml = await workbookXmlFile.async('text');
    const matches = xml.match(/<sheet\b/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

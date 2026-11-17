import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

/**
 * Parse the page count for an uploaded file.
 *
 * Supported formats:
 *   - PDF: pdf-lib (exact page count)
 *   - DOCX: ZIP parsing of docProps/app.xml <Pages> element
 *   - Images: 1 page each (or, for TIFF, frame/IFD count)
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

  // XLSX — worksheet count does NOT equal printed page count. An XLSX may
  // contain 1 worksheet that prints across 30 pages, or 5 worksheets that
  // print on 1 page each — the worksheet count is a structural property of
  // the workbook, not a print-layout property. Returning the worksheet
  // count as the "page count" was producing wildly wrong order totals.
  // Treat as needs_review so the shopkeeper/customer can confirm the
  // actual page count manually (or print-to-PDF and re-upload for an
  // exact count).
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return null;
  }

  // Images — each image is 1 page, EXCEPT TIFF which may have multiple
  // IFDs (frames) embedded in a single file.
  if (mimeType === 'image/tiff') {
    return countTiffFrames(bytes);
  }
  if (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/gif' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/bmp'
  ) {
    return 1;
  }

  // DOC, PPT, XLS (legacy binary formats), RTF, TXT, CSV, etc.
  // These require rendering/conversion to determine page count.
  // Mark for shopkeeper review.
  return null;
}

// ── ZIP-bomb protection (defense-in-depth) ────────────────────────────────
//
// The upload endpoint already caps file size at 25 MB, but a malicious ZIP
// can have a tiny compressed size and a HUGE uncompressed size (the classic
// "zip bomb": 42.zip is 42 KB → 4.5 GB). JSZip loads ALL entries into
// memory before we read any of them — a single malicious upload could
// exhaust the API process. The constants below stop that BEFORE we touch
// JSZip's loadAsync (which itself decodes the central directory).

/** Hard limit on compressed upload size — already enforced at upload, but
 *  re-checked here as defense-in-depth in case a caller bypasses the upload
 *  path (e.g. a future server-side import flow). */
const ZIP_MAX_COMPRESSED_BYTES = 25 * 1024 * 1024; // 25 MB

/** Hard limit on total UNCOMPRESSED size — a 25 MB ZIP can legitimately
 *  expand to ~100 MB of text-heavy DOCX/PPTX; anything beyond that is
 *  almost certainly malicious. */
const ZIP_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB

/** Hard limit on entry count — Office formats typically have <50 entries;
 *  1000 is a generous ceiling that catches pathological archives without
 *  rejecting legitimate ones. */
const ZIP_MAX_ENTRY_COUNT = 1000;

/** Loads a ZIP archive after applying zip-bomb defense-in-depth checks.
 *  Returns `null` if any limit is exceeded (treated as needs_review by the
 *  caller) or if the ZIP is malformed. */
async function safeLoadZip(
  bytes: Uint8Array,
): Promise<JSZip | null> {
  // Defense-in-depth: refuse any "ZIP" larger than the upload cap. This is
  // redundant with the upload-time check, but a future caller could bypass
  // it (server-side import, copy from another storage namespace, etc.).
  if (bytes.length > ZIP_MAX_COMPRESSED_BYTES) return null;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null; // malformed ZIP → needs_review
  }
  // Count entries + sum uncompressed sizes. JSZip exposes each entry with
  // `_data.uncompressedSize` (the decoded length) before we read any bytes.
  let totalUncompressed = 0;
  let entryCount = 0;
  zip.forEach(() => { entryCount++; });
  if (entryCount > ZIP_MAX_ENTRY_COUNT) return null;
  for (const entry of Object.values(zip.files)) {
    // `entry._data` is the internal JSZip metadata; `uncompressedSize` is
    // populated at central-directory parse time without reading bytes.
    const sz = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof sz === 'number' && sz > 0) {
      totalUncompressed += sz;
      if (totalUncompressed > ZIP_MAX_UNCOMPRESSED_BYTES) return null;
    }
  }
  return zip;
}

/**
 * Extract page count from a DOCX file by reading docProps/app.xml.
 *
 * The <Pages> element is set by Word when the document is saved.
 * If the element is missing or the file is malformed, return null.
 *
 * LIMITATION (audit H13): the count from `app.xml <Pages>` is a METADATA
 * ESTIMATE, not a rendered page count. Word writes the value when the
 * document is saved on a particular machine with particular fonts +
 * printer settings; opening the same DOCX on a different machine (or
 * printing it on a different printer) can produce a different page count
 * because of font substitution + margin differences. We treat this as
 * "auto_extracted" (priced immediately) because it's correct in the
 * common case where the customer uploaded a file just saved from their
 * own Word, but the shopkeeper should be aware that the count is an
 * estimate, not a guarantee. A future enhancement would render the DOCX
 * to PDF server-side for an exact count, but that's out of scope for the
 * current architecture.
 */
async function parseDocxPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const zip = await safeLoadZip(bytes);
    if (!zip) return null;
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
    const zip = await safeLoadZip(bytes);
    if (!zip) return null;
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

// NOTE on XLSX: the previous `parseXlsxPageCount` helper counted worksheets,
// which does not correspond to printed pages. The function has been removed
// — `parsePageCount` now returns `null` for `application/vnd.openxmlformats-
// officedocument.spreadsheetml.sheet`, marking the file as needs_review so
// the shopkeeper/customer supplies the actual page count (or re-uploads a
// print-to-PDF version for an exact count).

/**
 * Count the number of frames (IFDs) in a TIFF file by walking the Image
 * File Directory chain. TIFF can store multiple images in one file (e.g.
 * a multi-page scan), and each IFD is one frame → one printed page.
 *
 * Format:
 *   Bytes 0-1: byte order — `II` (little-endian) or `MM` (big-endian)
 *   Bytes 2-3: magic — `*\0` (LE: 0x2A 0x00) or `\0*` (BE: 0x00 0x2A)
 *   Bytes 4-7: offset to the first IFD (uint32 in the file's byte order)
 *
 * Each IFD:
 *   - 2 bytes: number of entries (uint16)
 *   - N * 12 bytes: the entries
 *   - 4 bytes: offset to the NEXT IFD (0 = end of chain)
 *
 * We walk the chain, counting IFDs. A safety cap (10000) prevents an
 * infinite loop on a maliciously-crafted file with a circular IFD chain.
 *
 * Returns `null` if the bytes don't look like a TIFF (caller will then
 * fall through to the generic "needs_review" path), or the frame count
 * (1 if the header is valid but the chain is broken/empty).
 */
function countTiffFrames(bytes: Uint8Array): number | null {
  if (bytes.length < 8) return null;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49; // II → little-endian
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d; // MM → big-endian
  if (!le && !be) return null;
  // Verify the magic 0x2A in the right byte order.
  if (le) {
    if (bytes[2] !== 0x2a || bytes[3] !== 0x00) return null;
  } else {
    if (bytes[2] !== 0x00 || bytes[3] !== 0x2a) return null;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readU32 = (off: number): number =>
    le ? dv.getUint32(off, true) : dv.getUint32(off, false);
  const readU16 = (off: number): number =>
    le ? dv.getUint16(off, true) : dv.getUint16(off, false);

  let ifdOffset = readU32(4);
  let frames = 0;
  const SAFETY_CAP = 10000;
  const seen = new Set<number>();
  while (ifdOffset !== 0 && frames < SAFETY_CAP) {
    // Bail on circular chains or out-of-range offsets.
    if (seen.has(ifdOffset)) break;
    seen.add(ifdOffset);
    if (ifdOffset + 2 > bytes.length) break;
    const entryCount = readU16(ifdOffset);
    const nextIfdOff = ifdOffset + 2 + entryCount * 12;
    if (nextIfdOff + 4 > bytes.length) {
      // Truncated IFD — count this frame + stop.
      frames++;
      break;
    }
    frames++;
    ifdOffset = readU32(nextIfdOff);
  }
  return frames > 0 ? frames : 1;
}

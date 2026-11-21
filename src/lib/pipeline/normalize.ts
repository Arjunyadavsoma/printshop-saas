import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';

/**
 * Document normalization (Phase 2, docs/ARCHITECTURE.md §5.1).
 *
 * REAL toolchain in this environment — nothing here is simulated:
 *  - PDF: validated (magic bytes, NOT encrypted), geometry read via pdf-lib.
 *  - Images (jpg/png/webp/heic): sharp (EXIF rotate → flatten on white →
 *    pixel cap ≈ A4 @ 300 dpi) then embedded into a single-page PDF via
 *    pdf-lib.
 *  - Office docs (docx/doc/pptx/xlsx): LibreOffice `soffice --headless`
 *    (present in this sandbox). Timeout-guarded; a failure marks the file
 *    FAILED with an honest reason — the API contract DOCX_TO_PDF_FALLBACK
 *    described in the brief is NOT used here because soffice IS available.
 */

const execFileAsync = promisify(execFile);

export type SourceKind = 'pdf' | 'image' | 'office' | 'unsupported';

export const OFFICE_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const OFFICE_EXT_TO_ARG: Record<string, string> = {
  docx: 'docx', doc: 'doc', pptx: 'pptx', xlsx: 'xlsx',
};

/** 4961×7016 px ≈ A4 portrait at 300 dpi — the pixel cap for images. */
const MAX_IMAGE_DIM = 4961;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function detectKind(mime: string, filename: string): SourceKind {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return 'image';
  if (OFFICE_MIMES.has(mime) || ext in OFFICE_EXT_TO_ARG) return 'office';
  return 'unsupported';
}

/** Magic-byte sniffing — declared MIME is client-controlled and untrusted. */
export function sniffKind(bytes: Uint8Array): 'pdf' | 'zip' | 'image' | 'heic' | 'unknown' {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf'; // %PDF-
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip'; // PK.. (office openxml)
  if (b.length >= 12 && b[8] === 0x66 && b[9] === 0x74 && b[10] === 0x79 && b[11] === 0x70) return 'heic'; // ....ftyp
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return 'image'; // jpeg
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image'; // png
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image'; // RIFF..WEBP
  return 'unknown';
}

export class NormalizeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export type NormalizedDoc = {
  pdfBytes: Uint8Array;
  pageCount: number;
  pageWidthPt: number;
  pageHeightPt: number;
  sha256: string;
};

/** Validate + read a PDF. Encrypted PDFs are rejected (decryption unsupported). */
export async function normalizePdf(bytes: Uint8Array): Promise<NormalizedDoc> {
  if (sniffKind(bytes) !== 'pdf') {
    throw new NormalizeError('NOT_A_PDF', 'The file does not look like a PDF (magic bytes missing).');
  }
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (/encrypt/i.test(msg)) {
      throw new NormalizeError('ENCRYPTED_PDF', 'This PDF is password-protected. Remove the password and upload again.');
    }
    throw new NormalizeError('CORRUPT_PDF', 'This PDF could not be read. The file may be corrupt.');
  }
  if (pdf.isEncrypted) {
    throw new NormalizeError('ENCRYPTED_PDF', 'This PDF is password-protected. Remove the password and upload again.');
  }
  const pages = pdf.getPages();
  if (pages.length === 0) {
    throw new NormalizeError('EMPTY_PDF', 'This PDF has no pages.');
  }
  const first = pages[0];
  return {
    pdfBytes: bytes,
    pageCount: pages.length,
    pageWidthPt: first.getWidth(),
    pageHeightPt: first.getHeight(),
    sha256: sha256Hex(bytes),
  };
}

/** Image → single-page PDF (EXIF rotate, white background, 300-dpi pixel cap). */
export async function normalizeImage(bytes: Uint8Array): Promise<NormalizedDoc> {
  type SharpFn = typeof import('sharp');
  let sharp: SharpFn;
  try {
    // sharp ships CJS `export =` — under interop the namespace may carry a
    // .default; handle both shapes.
    const mod = await import('sharp');
    sharp = ((mod as unknown as { default?: SharpFn }).default ?? (mod as unknown as SharpFn));
  } catch {
    throw new NormalizeError('IMAGE_PIPE_UNAVAILABLE', 'Image processing library unavailable — upload a PDF instead.');
  }
  try {
    const img = sharp(bytes, { failOn: 'error' })
      .rotate() // honour EXIF orientation
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: 'inside', withoutEnlargement: true })
      .png();
    const png = await img.png().toBuffer();
    const meta = await sharp(png).metadata();
    const doc = await PDFDocument.create();
    const page = doc.addPage([meta.width ?? 595, meta.height ?? 842]);
    const embedded = await doc.embedPng(png);
    page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    const out = await doc.save();
    return {
      pdfBytes: out,
      pageCount: 1,
      pageWidthPt: page.getWidth(),
      pageHeightPt: page.getHeight(),
      sha256: sha256Hex(out),
    };
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new NormalizeError('CORRUPT_IMAGE', `This image could not be processed (${msg.slice(0, 120)}). Try exporting it as JPG or PNG.`);
  }
}

/** Office document → PDF via LibreOffice headless (real). */
export async function normalizeOffice(bytes: Uint8Array, filename: string): Promise<NormalizedDoc> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const sofficeInput = OFFICE_EXT_TO_ARG[ext];
  if (!sofficeInput) {
    throw new NormalizeError('UNSUPPORTED_OFFICE', `.${ext} documents are not supported. Save as PDF and upload that.`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'pshop-conv-'));
  try {
    const inPath = path.join(dir, `input.${ext}`);
    await writeFile(inPath, bytes);
    let stdout: string;
    try {
      const res = await execFileAsync(
        'soffice',
        ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, inPath],
        { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );
      stdout = res.stdout;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (/ENOENT/i.test(msg)) {
        throw new NormalizeError('OFFICE_CONV_UNAVAILABLE', 'Document conversion service is not installed on this server. Please upload a PDF.');
      }
      throw new NormalizeError('OFFICE_CONV_FAILED', 'This document could not be converted to PDF. Open it in Word/PowerPoint/Excel and upload the PDF export.');
    }
    const outPath = path.join(dir, 'input.pdf');
    let pdfBytes: Buffer;
    try {
      pdfBytes = await readFile(outPath);
    } catch {
      throw new NormalizeError('OFFICE_CONV_FAILED', `Conversion produced no PDF${stdout ? ` (${stdout.trim().slice(0, 80)})` : ''}. Upload a PDF instead.`);
    }
    return normalizePdf(new Uint8Array(pdfBytes));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function normalizeDocument(bytes: Uint8Array, mime: string, filename: string): Promise<NormalizedDoc> {
  const kind = detectKind(mime, filename);
  switch (kind) {
    case 'pdf': return normalizePdf(bytes);
    case 'image': return normalizeImage(bytes);
    case 'office': return normalizeOffice(bytes, filename);
    default:
      throw new NormalizeError('UNSUPPORTED_TYPE', 'Supported: PDF, JPG, PNG, WEBP, HEIC, DOCX, DOC, PPTX, XLSX.');
  }
}

/**
 * F-08: File signature (magic bytes) validation.
 *
 * Client-declared MIME types are not trustworthy. This module validates
 * the ACTUAL file content by checking magic bytes at the start of the file.
 *
 * Supported formats:
 *   - PDF: %PDF- (bytes: 25 50 44 46 2D)
 *   - JPEG: FF D8 FF
 *   - PNG: 89 50 4E 47 0D 0A 1A 0A
 *   - WebP: RIFF....WEBP
 *   - GIF: 47 49 46 38
 *   - BMP: 42 4D
 *   - TIFF: 49 49 2A 00 or 4D 4D 00 2A
 */

export interface FileSignatureResult {
  valid: boolean;
  detectedType: string | null;
  error?: string;
}

/** Validate file signature against known magic bytes. */
export function validateFileSignature(
  bytes: Uint8Array,
  declaredMimeType: string,
): FileSignatureResult {
  if (!bytes || bytes.length < 4) {
    return { valid: false, detectedType: null, error: 'File too small to validate' };
  }

  // PDF: %PDF-
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    if (declaredMimeType !== 'application/pdf') {
      return { valid: false, detectedType: 'application/pdf', error: 'Declared MIME type does not match actual PDF content' };
    }
    return { valid: true, detectedType: 'application/pdf' };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    if (declaredMimeType !== 'image/jpeg') {
      return { valid: false, detectedType: 'image/jpeg', error: 'Declared MIME type does not match actual JPEG content' };
    }
    return { valid: true, detectedType: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (declaredMimeType !== 'image/png') {
      return { valid: false, detectedType: 'image/png', error: 'Declared MIME type does not match actual PNG content' };
    }
    return { valid: true, detectedType: 'image/png' };
  }

  // WebP: RIFF....WEBP
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    if (declaredMimeType !== 'image/webp') {
      return { valid: false, detectedType: 'image/webp', error: 'Declared MIME type does not match actual WebP content' };
    }
    return { valid: true, detectedType: 'image/webp' };
  }

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    if (declaredMimeType !== 'image/gif') {
      return { valid: false, detectedType: 'image/gif', error: 'Declared MIME type does not match actual GIF content' };
    }
    return { valid: true, detectedType: 'image/gif' };
  }

  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    if (declaredMimeType !== 'image/bmp') {
      return { valid: false, detectedType: 'image/bmp', error: 'Declared MIME type does not match actual BMP content' };
    }
    return { valid: true, detectedType: 'image/bmp' };
  }

  // TIFF: 49 49 2A 00 (little-endian) or 4D 4D 00 2A (big-endian)
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)) {
    if (declaredMimeType !== 'image/tiff') {
      return { valid: false, detectedType: 'image/tiff', error: 'Declared MIME type does not match actual TIFF content' };
    }
    return { valid: true, detectedType: 'image/tiff' };
  }

  // F-08: Unrecognized signatures (e.g., Office documents .docx/.xlsx) are
  // ALLOWED to pass through — they will be caught by the page-count parser
  // which returns null and marks the file as needs_review. This is safe
  // because the upload-url route already validates the MIME type against
  // ALLOWED_UPLOAD_MIME_TYPES, and the storage namespace is order-scoped.
  return { valid: true, detectedType: null };
}

/** Maximum page count for a single PDF (prevents resource exhaustion). */
export const MAX_PAGE_COUNT = 500;

/** Timeout for PDF parsing (prevents resource exhaustion from malicious files). */
export const PARSE_TIMEOUT_MS = 10_000;

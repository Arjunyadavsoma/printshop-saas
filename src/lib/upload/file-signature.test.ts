import { describe, expect, it } from 'vitest';
import { validateFileSignature, MAX_PAGE_COUNT } from './file-signature';

describe('F-08: File signature validation', () => {
  it('validates a real PDF signature', () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
    const result = validateFileSignature(pdfBytes, 'application/pdf');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('application/pdf');
  });

  it('allows unrecognized signatures through (e.g., Office docs)', () => {
    const officeBytes = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
    const result = validateFileSignature(officeBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    // Office docs are not validated by magic bytes — they pass through to
    // the page-count parser which returns null and marks as needs_review.
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBeNull();
  });

  it('rejects MIME type mismatch (declared PDF, actually JPEG)', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = validateFileSignature(jpegBytes, 'application/pdf');
    expect(result.valid).toBe(false);
    expect(result.detectedType).toBe('image/jpeg');
    expect(result.error).toContain('does not match');
  });

  it('validates a JPEG signature', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = validateFileSignature(jpegBytes, 'image/jpeg');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('image/jpeg');
  });

  it('validates a PNG signature', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const result = validateFileSignature(pngBytes, 'image/png');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('image/png');
  });

  it('rejects a file too small to validate', () => {
    const tinyBytes = new Uint8Array([0x25]);
    const result = validateFileSignature(tinyBytes, 'application/pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too small');
  });

  it('validates a WebP signature', () => {
    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const result = validateFileSignature(webpBytes, 'image/webp');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('image/webp');
  });

  it('MAX_PAGE_COUNT is reasonable', () => {
    expect(MAX_PAGE_COUNT).toBeLessThanOrEqual(1000);
    expect(MAX_PAGE_COUNT).toBeGreaterThan(0);
  });
});

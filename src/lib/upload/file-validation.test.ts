import { describe, it, expect } from 'vitest';
import {
  validateFile,
  parsePageRange,
  fileExt,
  ALLOWED_FILE_EXTENSIONS,
  type ExistingFile,
} from './file-validation';
import { MAX_UPLOAD_SIZE_BYTES } from '@platform/core/domain';

/**
 * Unit tests for the pure upload-validation helpers extracted into
 * `src/lib/upload/file-validation.ts`. These run in vitest with no DOM — the
 * functions take a plain `{ name, type, size, lastModified }` shape so they
 * can be exercised with literal objects.
 *
 * The validation logic mirrors the server's MIME allowlist + size cap and adds
 * client-side duplicate detection (name + size + lastModified) — the same
 * rules the consumer order page applies before minting a presigned URL.
 */

describe('validateFile', () => {
  describe('valid files', () => {
    it('1. accepts a single valid PDF', () => {
      const result = validateFile(
        { name: 'invoice.pdf', type: 'application/pdf', size: 12_000, lastModified: 1_700_000_000_000 },
        [],
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('2. accepts multiple files in one batch when none are duplicates', () => {
      const existing: ExistingFile[] = [];
      const files = [
        { name: 'a.pdf', type: 'application/pdf', size: 1000, lastModified: 1 },
        { name: 'b.png', type: 'image/png', size: 2000, lastModified: 2 },
        { name: 'c.jpg', type: 'image/jpeg', size: 3000, lastModified: 3 },
      ];
      for (const f of files) {
        const r = validateFile(f, existing);
        expect(r.valid, `expected ${f.name} to be valid`).toBe(true);
        // Simulate the page adding each validated file to its list before the
        // next one is checked — the page does this so a customer dropping
        // two files with the same name in one batch is warned.
        existing.push({ filename: f.name, size: f.size, lastModified: f.lastModified });
      }
    });

    it('accepts an image without a MIME type via the extension fallback', () => {
      // Browsers sometimes report an empty file.type for non-standard formats.
      // The validator falls back to the extension allowlist.
      const result = validateFile(
        { name: 'scan.jpeg', type: '', size: 5000, lastModified: 1 },
        [],
      );
      expect(result.valid).toBe(true);
    });

    it('accepts a file at exactly the size cap (boundary)', () => {
      const result = validateFile(
        { name: 'edge.pdf', type: 'application/pdf', size: MAX_UPLOAD_SIZE_BYTES, lastModified: 1 },
        [],
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('rejections', () => {
    it('3. rejects an unsupported file type (.exe — not in MIME or extension allowlist)', () => {
      const result = validateFile(
        { name: 'malware.exe', type: 'application/x-msdownload', size: 1000, lastModified: 1 },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/supported file type/i);
      // The error names the offending file so the toast is actionable.
      expect(result.error).toContain('malware.exe');
    });

    it('4. rejects an oversized file (just over the 25 MB cap)', () => {
      const tooBig = MAX_UPLOAD_SIZE_BYTES + 1;
      const result = validateFile(
        { name: 'huge.pdf', type: 'application/pdf', size: tooBig, lastModified: 1 },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/limit/i);
      expect(result.error).toContain('25');
    });

    it('5. rejects an empty file (size === 0)', () => {
      const result = validateFile(
        { name: 'empty.pdf', type: 'application/pdf', size: 0, lastModified: 1 },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/empty/i);
    });

    it('6. rejects a duplicate selection (same name + size + lastModified)', () => {
      const existing: ExistingFile[] = [
        { filename: 'invoice.pdf', size: 12_000, lastModified: 1_700_000_000_000 },
      ];
      const result = validateFile(
        { name: 'invoice.pdf', type: 'application/pdf', size: 12_000, lastModified: 1_700_000_000_000 },
        existing,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/already/i);
    });
  });

  describe('file replacement (remove + re-add with same name)', () => {
    it('7. accepts a new file with the same name as a removed file', () => {
      // Customer removes a file from the list, then adds a different file
      // that happens to share the name. The validator sees only the current
      // list (no entry for the removed file), so the new file is valid.
      const existing: ExistingFile[] = [
        { filename: 'invoice.pdf', size: 12_000, lastModified: 1_700_000_000_000 },
      ];
      // Customer removes 'invoice.pdf' → existing shrinks to [].
      existing.length = 0;
      // Now they add a new file with the same name (different size + mtime).
      const result = validateFile(
        { name: 'invoice.pdf', type: 'application/pdf', size: 9_999, lastModified: 1_700_000_001_111 },
        existing,
      );
      expect(result.valid).toBe(true);
    });

    it('rejects a same-name file when name+size match but lastModified differs only for hydrated entries', () => {
      // Server-hydrated files (no lastModified) match on name+size only.
      // A freshly-picked file with the same name+size IS considered a dup,
      // even though its lastModified differs — the hydrated entry can't
      // compare mtimes, so it conservatively treats it as a duplicate.
      const existing: ExistingFile[] = [
        { filename: 'old.pdf', size: 1024 }, // no lastModified — hydrated
      ];
      const result = validateFile(
        { name: 'old.pdf', type: 'application/pdf', size: 1024, lastModified: 9_999 },
        existing,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/already/i);
    });

    it('treats same name+size but different lastModified as a NEW file when both are fresh', () => {
      // Two freshly-picked files with the same name+size but different
      // lastModified are NOT duplicates — the customer may have re-saved the
      // document. This is the optimistic case that prevents false rejections.
      const existing: ExistingFile[] = [
        { filename: 'doc.pdf', size: 1024, lastModified: 100 },
      ];
      const result = validateFile(
        { name: 'doc.pdf', type: 'application/pdf', size: 1024, lastModified: 200 },
        existing,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('fileExt + ALLOWED_FILE_EXTENSIONS sanity', () => {
    it('fileExt lowercases the extension and handles missing dots', () => {
      expect(fileExt('photo.JPG')).toBe('jpg');
      expect(fileExt('archive.tar.gz')).toBe('gz');
      expect(fileExt('noext')).toBe('');
      expect(fileExt('trailing.')).toBe('');
    });

    it('ALLOWED_FILE_EXTENSIONS covers PDF + common image + Office + text', () => {
      expect(ALLOWED_FILE_EXTENSIONS.has('pdf')).toBe(true);
      expect(ALLOWED_FILE_EXTENSIONS.has('png')).toBe(true);
      expect(ALLOWED_FILE_EXTENSIONS.has('jpg')).toBe(true);
      expect(ALLOWED_FILE_EXTENSIONS.has('jpeg')).toBe(true);
      expect(ALLOWED_FILE_EXTENSIONS.has('docx')).toBe(true);
      expect(ALLOWED_FILE_EXTENSIONS.has('txt')).toBe(true);
      expect(ALLOWED_FILE_EXTENSIONS.has('exe')).toBe(false);
    });
  });
});

describe('parsePageRange', () => {
  describe('valid inputs', () => {
    it('8. parses a single contiguous range: "1-5" → [1,2,3,4,5]', () => {
      expect(parsePageRange('1-5', 10)).toEqual([1, 2, 3, 4, 5]);
    });

    it('9. parses comma-separated single pages: "1,3,5" → [1,3,5]', () => {
      expect(parsePageRange('1,3,5', 10)).toEqual([1, 3, 5]);
    });

    it('10. parses a mixed range + singles: "2-4,8,10-12" → [2,3,4,8,10,11,12]', () => {
      expect(parsePageRange('2-4,8,10-12', 12)).toEqual([2, 3, 4, 8, 10, 11, 12]);
    });

    it('11. returns null for "all" (sentinel: caller uses the full page count)', () => {
      expect(parsePageRange('all', 10)).toBeNull();
      expect(parsePageRange('ALL', 10)).toBeNull(); // case-insensitive
      expect(parsePageRange('  all  ', 10)).toBeNull(); // whitespace trimmed
    });

    it('returns null for an empty string (treated as "all")', () => {
      expect(parsePageRange('', 10)).toBeNull();
      expect(parsePageRange('   ', 10)).toBeNull();
    });

    it('deduplicates overlapping ranges: "1-3,2-4" → [1,2,3,4]', () => {
      expect(parsePageRange('1-3,2-4', 10)).toEqual([1, 2, 3, 4]);
    });

    it('returns a sorted array even when input is out of order: "5,1,3" → [1,3,5]', () => {
      expect(parsePageRange('5,1,3', 10)).toEqual([1, 3, 5]);
    });

    it('accepts a single-page range equal to maxPages: "10-10" with maxPages=10', () => {
      expect(parsePageRange('10-10', 10)).toEqual([10]);
    });
  });

  describe('invalid inputs', () => {
    it('12. rejects "0" — page numbers are 1-based', () => {
      expect(parsePageRange('0', 10)).toBeNull();
    });

    it('13. rejects an out-of-range single page: "15" with maxPages=10', () => {
      expect(parsePageRange('15', 10)).toBeNull();
    });

    it('14. rejects a reversed range: "5-3" → null', () => {
      expect(parsePageRange('5-3', 10)).toBeNull();
    });

    it('15. rejects a malformed range with two dashes: "1-2-3" → null', () => {
      expect(parsePageRange('1-2-3', 10)).toBeNull();
    });

    it('rejects non-numeric input: "abc"', () => {
      expect(parsePageRange('abc', 10)).toBeNull();
    });

    it('rejects a range whose start exceeds maxPages: "11-12" with maxPages=10', () => {
      expect(parsePageRange('11-12', 10)).toBeNull();
    });

    it('rejects a range whose end exceeds maxPages: "8-12" with maxPages=10', () => {
      expect(parsePageRange('8-12', 10)).toBeNull();
    });

    it('rejects a negative page: "-1"', () => {
      // "-1" splits into ['', '1'] → start=NaN → null.
      expect(parsePageRange('-1', 10)).toBeNull();
    });
  });
});

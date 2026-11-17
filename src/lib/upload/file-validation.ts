import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from '@platform/core/domain';

/**
 * Pure, browser-agnostic upload-validation helpers extracted from the
 * consumer order page (`src/app/orders/[id]/page.tsx`).
 *
 * These were inlined in the page component to keep the upload flow cohesive,
 * but lifting them into a module means:
 *  - the same logic is exercised by vitest unit tests (no DOM required),
 *  - future server-side pre-validation (e.g. a Next.js Server Action) can
 *    reuse the exact same rules,
 *  - the page component shrinks and stays presentational.
 *
 * The functions are pure: they take a plain `{ name, type, size, lastModified }`
 * shape (a structural subset of the DOM `File`) so they can be called from
 * tests without constructing a real File object.
 */

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

/** A previously-selected file the new file should be checked against for duplicates. */
export interface ExistingFile {
  filename: string;
  size: number;
  /** DOM File.lastModified — undefined for server-hydrated files (no rawFile). */
  lastModified?: number;
}

/**
 * Extension mirror of the server MIME allowlist. Browsers sometimes report an
 * empty `file.type` for some formats (e.g. .docx), so we validate against
 * BOTH the MIME type AND the extension as a fallback. Kept in sync with
 * `ALLOWED_UPLOAD_MIME_TYPES` in `packages/core/src/domain/file.ts`.
 */
export const ALLOWED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf', // application/pdf
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', // images
  'tiff', 'tif',
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', // MS Office
  'odt', 'ods', 'odp', // OpenDocument
  'rtf', 'txt', 'csv', // Rich/text
  'msg', 'tex', // Other
]);

/** Extract the lower-cased extension (without the dot) from a filename. */
export function fileExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

/**
 * Validate a file before upload. Checks (in order):
 *  1. Empty file (`size === 0`)
 *  2. File size cap (`MAX_UPLOAD_SIZE_BYTES` — 25 MB)
 *  3. File type — MIME type preferred, extension fallback for browsers that
 *     report an empty MIME. Either match is sufficient.
 *  4. Duplicate detection — compares `name + size + lastModified` against the
 *     existing file list. For server-hydrated files (no `lastModified`),
 *     name+size is the best we can do.
 *
 * @returns `{ valid: true }` or `{ valid: false, error }` with a
 *          human-readable, actionable error message.
 */
export function validateFile(
  file: { name: string; type: string; size: number; lastModified?: number },
  existingFiles: ExistingFile[],
): FileValidationResult {
  // 1. Empty file
  if (file.size === 0) {
    return { valid: false, error: `"${file.name}" is empty (0 bytes) and can't be printed.` };
  }
  // 2. Size cap (mirrors server MAX_UPLOAD_SIZE_BYTES)
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    const maxMb = (MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    return { valid: false, error: `"${file.name}" is ${fileMb}MB — the limit is ${maxMb}MB.` };
  }
  // 3. Type allowlist — MIME (preferred) OR extension (fallback when MIME empty)
  const ext = fileExt(file.name);
  const mimeOk = !!file.type && (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type);
  const extOk = ALLOWED_FILE_EXTENSIONS.has(ext);
  if (!mimeOk && !extOk) {
    return {
      valid: false,
      error: `"${file.name}" isn't a supported file type. Use PDF, image, or Office documents.`,
    };
  }
  // 4. Duplicate detection (P1-08) — name + size + lastModified
  const isDuplicate = existingFiles.some(
    (f) =>
      f.filename === file.name &&
      f.size === file.size &&
      // When the existing entry has a lastModified (a freshly-picked file), the
      // new file's lastModified must also match — same name+size at a different
      // mtime is a new file. When the existing entry has no lastModified
      // (server-hydrated), name+size is the best we can do.
      (f.lastModified === undefined || f.lastModified === file.lastModified),
  );
  if (isDuplicate) {
    return { valid: false, error: `"${file.name}" is already in your upload list.` };
  }
  return { valid: true };
}

/**
 * Parse a page-range string into a sorted list of 1-based page numbers.
 *
 * Supports:
 *  - `"all"` (or empty string) → `null`, meaning "all pages" — the caller
 *    treats null as "use the file's full page count".
 *  - Single page: `"3"` → `[3]`
 *  - Range: `"1-5"` → `[1, 2, 3, 4, 5]`
 *  - Comma-separated mix: `"2-4,8,10-12"` → `[2, 3, 4, 8, 10, 11, 12]`
 *
 * Returns `null` when the input is malformed or references a page outside
 * `[1, maxPages]`. Whitespace is trimmed; case-insensitive for `"all"`.
 *
 * @param input     the raw page-range string from the user
 * @param maxPages  the document's total page count (upper bound for validation)
 * @returns         sorted unique page numbers, or `null` for "all pages" /
 *                  invalid input.
 */
export function parsePageRange(input: string, maxPages: number): number[] | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'all') {
    return null; // null = all pages
  }
  const pages = new Set<number>();
  const parts = trimmed.split(',');
  for (const part of parts) {
    const range = part.trim().split('-');
    if (range.length === 1) {
      const n = parseInt(range[0] ?? '', 10);
      if (isNaN(n) || n < 1 || n > maxPages) return null;
      pages.add(n);
    } else if (range.length === 2) {
      const start = parseInt(range[0] ?? '', 10);
      const end = parseInt(range[1] ?? '', 10);
      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 1 ||
        end < 1 ||
        start > maxPages ||
        end > maxPages ||
        start > end
      ) {
        return null;
      }
      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      return null; // e.g. "1-2-3"
    }
  }
  return pages.size > 0 ? Array.from(pages).sort((a, b) => a - b) : null;
}

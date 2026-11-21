import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Page thumbnails (Phase 2) — REAL renders via poppler's `pdftoppm`
 * (present in this sandbox). One PNG per page at 48 dpi; the customer page
 * grid and the shopkeeper page-mode map are built from these.
 */

const execFileAsync = promisify(execFile);

export const THUMB_DPI = 48;
/** Hard cap — a 500-page doc still gets a grid; beyond this the UI falls back to numbers-only. */
export const MAX_THUMBS = 120;

export async function renderThumbnails(pdfBytes: Uint8Array, pageCount: number): Promise<Array<{ page: number; png: Uint8Array }>> {
  const count = Math.min(pageCount, MAX_THUMBS);
  if (count === 0) return [];
  const dir = await mkdtemp(path.join(tmpdir(), 'pshop-thumbs-'));
  try {
    const pdfPath = path.join(dir, 'doc.pdf');
    await writeFile(pdfPath, pdfBytes);
    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', String(THUMB_DPI), '-f', '1', '-l', String(count), pdfPath, path.join(dir, 'p')],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const files = (await readdir(dir)).filter(f => f.startsWith('p') && f.endsWith('.png')).sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      return na - nb;
    });
    const thumbs: Array<{ page: number; png: Uint8Array }> = [];
    for (let i = 0; i < files.length; i++) {
      thumbs.push({ page: i + 1, png: new Uint8Array(await readFile(path.join(dir, files[i]))) });
    }
    return thumbs;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

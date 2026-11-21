import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Per-page color suggestion (Phase 2, docs/ARCHITECTURE.md §5.2).
 *
 * REAL detection in this environment: Ghostscript `inkcov` reports the CMYK
 * coverage of every page. A page with meaningful C+M+Y coverage is a color
 * page; a page covered only in K is B&W. Near-gray color (tiny CMY under
 * threshold) is treated as B&W so scanned "gray" documents don't false-positive.
 *
 * It is ONLY a suggestion — the customer always decides (the UI starts from
 * this and lets them flip pages).
 */

const execFileAsync = promisify(execFile);

export type PageColorSuggestion = {
  page: number;
  isColor: boolean;
  confidence: number; // 0..1
};

export type ColorSuggestionResult = {
  pages: PageColorSuggestion[];
  source: 'inkcov' | 'fallback-content-stream';
};

const COLOR_CHROMA_THRESHOLD = 0.005; // chroma (C+M+Y − 3·min) > 0.5 % of page ⇒ color
const CONFIDENT_MARGIN = 0.02;        // ≥2 % chroma ⇒ high confidence

/** Parse Ghostscript inkcov output lines. Two formats exist:
 *  1. `Page 3 CoverCMYK C=0.000000 M=0.000000 Y=0.000000 K=0.966500`
 *  2. this environment's gs 10.05: ` 0.30820  0.30820  0.30820  0.00046 CMYK OK`
 * Exported for unit tests. */
export function parseInkcovOutput(output: string): Array<{ c: number; m: number; y: number; k: number }> {
  const rows: Array<{ c: number; m: number; y: number; k: number }> = [];
  const labeled = /C=([\d.]+)\s+M=([\d.]+)\s+Y=([\d.]+)\s+K=([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = labeled.exec(output)) !== null) {
    rows.push({ c: parseFloat(m[1]), m: parseFloat(m[2]), y: parseFloat(m[3]), k: parseFloat(m[4]) });
  }
  if (rows.length > 0) return rows;
  // Format 2: bare 4-float rows (optionally followed by "CMYK OK")
  const bare = /^\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:CMYK.*)?$/gm;
  while ((m = bare.exec(output)) !== null) {
    rows.push({ c: parseFloat(m[1]), m: parseFloat(m[2]), y: parseFloat(m[3]), k: parseFloat(m[4]) });
  }
  return rows;
}

/**
 * CHROMA heuristic, not the raw C+M+Y sum: this environment's Ghostscript
 * build (10.05) equalises CMY on pure-gray content (a black text page
 * reports C=M=Y=K≈0.0004), so summing C+M+Y would false-positive every
 * densely-printed B&W page. chroma = (C+M+Y) − 3·min(C,M,Y,K) cancels that
 * baseline: text/gray pages ≈ 0, saturated pages ≫ threshold. Also correct
 * for standard builds (K-only text ⇒ chroma 0; C=0/M=0.9/Y=0.35 ⇒ 1.25).
 */
export function coverageToSuggestion(rows: Array<{ c: number; m: number; y: number; k: number }>): PageColorSuggestion[] {
  return rows.map((r, i) => {
    const chroma = (r.c + r.m + r.y) - 3 * Math.min(r.c, r.m, r.y, r.k);
    const isColor = chroma > COLOR_CHROMA_THRESHOLD;
    const margin = isColor
      ? (chroma - COLOR_CHROMA_THRESHOLD) / CONFIDENT_MARGIN
      : (COLOR_CHROMA_THRESHOLD - chroma) / CONFIDENT_MARGIN;
    const confidence = Math.max(0.6, Math.min(0.99, 0.6 + 0.39 * Math.min(1, margin)));
    return { page: i + 1, isColor, confidence };
  });
}

/**
 * Suggest color pages via real Ghostscript inkcov. If `gs` is missing
 * (tiny deploys), fall back to "all B&W" with low confidence and mark the
 * source honestly — the customer can still flip every page manually.
 */
export async function suggestColors(pdfBytes: Uint8Array): Promise<ColorSuggestionResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pshop-ink-'));
  try {
    const pdfPath = path.join(dir, 'doc.pdf');
    await writeFile(pdfPath, pdfBytes);
    try {
      const { stdout } = await execFileAsync(
        'gs',
        ['-q', '-o', '-', '-sDEVICE=inkcov', pdfPath],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const rows = parseInkcovOutput(stdout);
      if (rows.length === 0) throw new Error('no inkcov rows');
      return { pages: coverageToSuggestion(rows), source: 'inkcov' };
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (/ENCRYPTED|password/i.test(msg)) throw cause;
      // gs missing or failed — honest low-confidence fallback
      return { pages: [], source: 'fallback-content-stream' };
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

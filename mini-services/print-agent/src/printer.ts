import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface PrintResult {
  ok: boolean;
  printerName: string | null;
  error?: string;
}

export interface PrintSettings {
  copies: number;
  colorMode: string;
  duplex: boolean;
  paperSize: string;
}

/**
 * Send a file to the local printer.
 *
 * Windows:  `pdf-to-printer` (SumatraPDF under the hood)
 * macOS:    `lp` (CUPS)
 * Linux:    `lp` (CUPS)
 *
 * In demo mode (PRINT_AGENT_DEMO=1) the print command is skipped — useful in
 * the sandbox where no real printer is attached. The download + temp-file
 * steps still run, exercising the full path.
 */
export async function printFile(
  filePath: string,
  opts: PrintSettings,
): Promise<PrintResult> {
  if (process.env.PRINT_AGENT_DEMO === '1') {
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true, printerName: 'demo-printer' };
  }
  const os = platform();
  try {
    if (os === 'win32') {
      // `npm i -g pdf-to-printer` provides this CLI.
      const args = [filePath, '-n', String(opts.copies)];
      if (opts.colorMode === 'bw') args.push('-m', 'grayscale');
      if (opts.duplex) args.push('-d', 'two-sided-long-edge');
      const { stdout } = await execFileAsync('pdf-to-printer', args);
      return { ok: true, printerName: stdout.trim() || null };
    }
    // macOS / Linux — CUPS `lp`.
    const args = ['-n', String(opts.copies)];
    if (opts.colorMode === 'bw') args.push('-o', 'ColorModel=Gray');
    if (opts.duplex) args.push('-o', 'sides=two-sided-long-edge');
    const printer = process.env.PRINTER_NAME;
    if (printer) args.unshift('-d', printer);
    const { stdout } = await execFileAsync('lp', [...args, filePath]);
    const m = stdout.match(/request id is (.+?)(?:\s|$)/);
    return { ok: true, printerName: m?.[1] ?? null };
  } catch (err) {
    return { ok: false, printerName: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Write downloaded bytes to a temp file for printing. */
export function writeToTemp(name: string, bytes: Uint8Array): string {
  const dir = join(tmpdir(), 'print-agent');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${Date.now()}-${name}`);
  writeFileSync(path, bytes);
  return path;
}

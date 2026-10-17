/**
 * Generate a minimal valid 1-page PDF for E2E testing.
 * Uses pdf-lib (already a dependency).
 *
 * Run: bun run scripts/make-test-pdf.ts
 * Outputs: /home/z/my-project/tmp/test.pdf
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]); // A4 in points
  page.drawText('PrintShop E2E Test Document', { x: 50, y: 800, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('Page 1 — This is a test PDF for staging validation.', { x: 50, y: 760, size: 12, font, color: rgb(0, 0, 0) });
  const bytes = await pdf.save();
  const outDir = resolve(import.meta.dir, '../tmp');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'test.pdf');
  writeFileSync(outPath, bytes);
  console.log(`Wrote ${bytes.length}-byte PDF to ${outPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

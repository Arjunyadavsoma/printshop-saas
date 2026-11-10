/**
 * Generate a 3-page PDF fixture for the consumer-journey E2E test.
 *
 * Uses pdf-lib (already a dependency). Outputs to
 * `tests/fixtures/sample-3-page.pdf` — a small, valid, non-sensitive PDF
 * with 3 pages, each labelled "Page N of 3". The fixture is committed
 * so the E2E test doesn't need to regenerate it on every run.
 *
 * Run: `bun run tests/fixtures/generate-pdf.ts`
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= 3; i++) {
    const page = pdf.addPage([595, 842]); // A4 in points
    page.drawText('PrintShop E2E Fixture', {
      x: 50, y: 800, size: 24, font, color: rgb(0, 0, 0),
    });
    page.drawText(`Page ${i} of 3`, {
      x: 50, y: 760, size: 14, font, color: rgb(0, 0, 0),
    });
    page.drawText('This is a non-sensitive test document for the', {
      x: 50, y: 720, size: 12, font, color: rgb(0, 0, 0),
    });
    page.drawText('Phase 6.3 consumer-journey PDF preview E2E test.', {
      x: 50, y: 700, size: 12, font, color: rgb(0, 0, 0),
    });
  }

  const bytes = await pdf.save();
  const outDir = resolve(import.meta.dir);
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'sample-3-page.pdf');
  writeFileSync(outPath, bytes);
  console.log(`Wrote ${bytes.length}-byte 3-page PDF to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

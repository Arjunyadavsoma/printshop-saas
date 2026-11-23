/**
 * gen-pdf-fixtures.ts — generates test PDFs for performance testing.
 *
 * Generates 50, 200, and 500-page PDFs with mixed B&W text + color image
 * pages, used by the page-strip performance test.
 *
 * Usage: npx tsx scripts/gen-pdf-fixtures.ts
 * Output: docs/redesign/evidence/fixtures/{50,200,500}-page.pdf
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

async function generatePDF(pageCount: number, outputPath: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([595, 842]); // A4
    const isColor = i > Math.floor(pageCount * 0.8); // Last 20% are color

    if (isColor) {
      // Color page: magenta rectangle + cyan text
      page.drawRectangle({ x: 50, y: 50, width: 495, height: 742, color: rgb(0.76, 0.09, 0.36) });
      page.drawText(`Page ${i} — Colour`, { x: 100, y: 700, size: 24, font: bold, color: rgb(1, 1, 1) });
      page.drawText('This page has colour content.', { x: 100, y: 670, size: 12, font, color: rgb(1, 1, 1) });
    } else {
      // B&W page: black text on white
      page.drawText(`Page ${i}`, { x: 100, y: 700, size: 24, font: bold, color: rgb(0, 0, 0) });
      page.drawText('This page has black and white text content.', { x: 100, y: 670, size: 12, font, color: rgb(0.06, 0.11, 0.18) });
      // Add some lines to simulate text content
      for (let line = 0; line < 20; line++) {
        page.drawText(`Line ${line + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`, {
          x: 100, y: 640 - line * 25, size: 10, font, color: rgb(0.06, 0.11, 0.18),
        });
      }
    }
  }

  const bytes = await doc.save();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);
  console.log(`Generated: ${outputPath} (${pageCount} pages, ${(bytes.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  const dir = 'docs/redesign/evidence/fixtures';
  await generatePDF(50, path.join(dir, '50-page.pdf'));
  await generatePDF(200, path.join(dir, '200-page.pdf'));
  await generatePDF(500, path.join(dir, '500-page.pdf'));
  console.log('Done.');
}

main().catch(console.error);

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PlannedTask, CollationStep } from './planner';

/**
 * Task PDF builder (Phase 3, brief §5.3 e) — takes the NORMALIZED source PDF
 * and a planned task, emits the task's printable PDF:
 *  - N-up imposition (2/4/6/9 pages per side, ordered left-to-right,
 *    top-to-bottom);
 *  - duplex: front side pages then back side pages; a missing back side is
 *    padded with a BLANK page so physical sheet pairing stays correct;
 *  - assembly slip: a one-page printable guide with the interleaving steps,
 *    order meta and an order-token QR (qrcode package, real PNG).
 */

const A4: [number, number] = [595.28, 841.89];

function gridLayout(nUp: number): { cols: number; rows: number } {
  switch (nUp) {
    case 2: return { cols: 1, rows: 2 };
    case 4: return { cols: 2, rows: 2 };
    case 6: return { cols: 2, rows: 3 };
    case 9: return { cols: 3, rows: 3 };
    default: return { cols: 1, rows: 1 };
  }
}

/** Build the printable PDF for one task. Returns the PDF bytes. */
export async function buildTaskPdf(sourceBytes: Uint8Array, task: PlannedTask, opts?: {
  /** Override target size (defaults to A4 — the spec's paper size). */
  pageSize?: [number, number];
}): Promise<Uint8Array> {
  const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
  const out = await PDFDocument.create();
  const [pw, ph] = opts?.pageSize ?? A4;
  const { cols, rows } = gridLayout(task.pagesPerSheet);
  const cellW = pw / cols;
  const cellH = ph / rows;
  const margin = 12;

  for (const sheet of task.sheets) {
    for (const side of [sheet.front, sheet.back]) {
      if (side.length === 0 && !task.duplex) continue; // single-sided: no blank sides
      const page = out.addPage([pw, ph]);
      for (let i = 0; i < side.length && i < task.pagesPerSheet; i++) {
        const srcPageIdx = side[i]! - 1;
        if (srcPageIdx < 0 || srcPageIdx >= src.getPageCount()) continue;
        const [embedded] = await out.embedPdf(src, [srcPageIdx]);
        const col = i % cols;
        const row = Math.floor(i / cols);
        // scale the source page to fit its cell, centered
        const srcSize = src.getPage(srcPageIdx).getSize();
        const scale = Math.min((cellW - margin * 2) / srcSize.width, (cellH - margin * 2) / srcSize.height);
        const w = srcSize.width * scale;
        const h = srcSize.height * scale;
        const x = col * cellW + (cellW - w) / 2;
        // rows fill top-down
        const y = ph - (row + 1) * cellH + (cellH - h) / 2;
        page.drawPage(embedded, { x, y, width: w, height: h });
        // hairline cell border — structure that shows the N-up grouping
        page.drawRectangle({
          x: col * cellW + 2, y: ph - (row + 1) * cellH + 2,
          width: cellW - 4, height: cellH - 4,
          borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5, opacity: 0,
          borderOpacity: 0.5,
        });
      }
    }
  }
  return out.save();
}

export type SlipInput = {
  orderNumber: string;
  orderShortId: string;
  customerName: string;
  pickupCode: string;
  copies: number;
  steps: CollationStep[];
  /** QR payload — the order token URL (/o/<token>). */
  qrPayload?: string;
};

/** The shopkeeper's assembly slip — one printable page. */
export async function buildAssemblySlip(input: SlipInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = A4[1] - 70;
  page.drawText(`Assembly slip — order ${input.orderNumber}`, { x: 48, y, size: 20, font: bold });
  y -= 26;
  page.drawText(`${input.customerName} · pickup code ${input.pickupCode} · ${input.copies} cop${input.copies === 1 ? 'y' : 'ies'}`, { x: 48, y, size: 12, font });
  y -= 34;

  page.drawText('For each copy, assemble the sets in this order:', { x: 48, y, size: 13, font: bold });
  y -= 24;
  for (const step of input.steps) {
    const label = step.colorMode === 'COLOR' ? 'COLOR set' : 'B&W set';
    page.drawText(`•  ${label}: pages ${step.pages}`, { x: 60, y, size: 12, font: step.colorMode === 'COLOR' ? bold : font });
    y -= 20;
  }

  y -= 30;
  page.drawText('Check every copy against this list before handing it over.', { x: 48, y, size: 11, font });

  // QR of the order tracking link (real PNG via qrcode)
  if (input.qrPayload) {
    try {
      const QRCode = (await import('qrcode')).default;
      const pngDataUrl = await QRCode.toDataURL(input.qrPayload, { width: 240, margin: 0 });
      const png = await doc.embedPng(pngDataUrl);
      page.drawImage(png, { x: A4[0] - 190, y: A4[1] - 210, width: 140, height: 140 });
      page.drawText('Scan to open the order', { x: A4[0] - 190, y: A4[1] - 226, size: 8, font });
    } catch { /* slip still valid without QR */ }
  }
  return doc.save();
}

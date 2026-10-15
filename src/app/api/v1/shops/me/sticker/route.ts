import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { toAppError, fail } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/shops/me/sticker — a printable A4 sheet with the shop's
 * customer QR repeated as a sheet of stickers (so the shopkeeper can print
 * and stick them anywhere). Rendered as a real PDF via pdf-lib.
 */
export const GET = withAuth(async (_req, _ctx, principal) => {
  try {
    const shop = await repos.shops.getByOwner(principal.userId);
    if (!shop.upiId) throw new NotFoundError('Shop has no UPI configured');
    const customerUrl = `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/${shop.slug}`;
    const qrPng = await QRCode.toBuffer(customerUrl, { margin: 1, width: 300, type: 'png' });

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const qrImage = await doc.embedPng(qrPng);
    const page = doc.addPage([595, 842]); // A4 portrait, points
    const W = 595;
    // Sheet of 6 stickers, 3 columns × 2 rows.
    const cols = 3, rows = 2;
    const cellW = W / cols;
    const cellH = 260;
    const startY = 842 - 40;
    for (let i = 0; i < cols * rows; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = c * cellW + (cellW - 150) / 2;
      const y = startY - r * cellH - 150;
      page.drawImage(qrImage, { x, y, width: 150, height: 150 });
      page.drawText(shop.name, { x: x + (150 - bold.widthOfTextAtSize(shop.name, 11)) / 2, y: y - 16, size: 11, font: bold, color: rgb(0, 0, 0) });
      page.drawText('Scan to print', { x: x + (150 - font.widthOfTextAtSize('Scan to print', 9)) / 2, y: y - 30, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    }
    const bytes = await doc.save();
    return new NextResponse(bytes, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${shop.slug}-stickers.pdf"` },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { repos } from '@/lib/repositories';
import { NotFoundError } from '@platform/core/errors';
import { formatINRFromPaise } from '@platform/utils';
import { priceFile, type PricingInput } from '@platform/core/pricing';

/** GET /api/v1/orders/:id/receipt — downloadable PDF receipt. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const order = await repos.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');
    if (order.status === 'awaiting_payment' || order.status === 'cancelled') {
      throw new NotFoundError('Receipt available only for paid orders');
    }

    const files = await repos.files.findByOrder(order.id);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 842]); // A4 portrait, points
    const { x, y } = { x: 50, y: 800 };

    page.drawText('PRINT RECEIPT', { x, y, size: 20, font: bold, color: rgb(0, 0, 0) });
    page.drawText(shop.name, { x, y: y - 28, size: 12, font });
    page.drawText(`Token: ${order.customerToken}`, { x, y: y - 46, size: 12, font });
    page.drawText(`Order: ${order.id.slice(0, 8)}`, { x, y: y - 62, size: 10, font });
    page.drawText(`Date: ${order.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, { x, y: y - 78, size: 10, font });

    let cursor = y - 110;
    page.drawText('Line items', { x, y: cursor, size: 12, font: bold });
    cursor -= 18;
    for (const f of files) {
      const pricingInput: PricingInput = {
        pages: f.pageCount ?? 1,
        copies: f.copies,
        colorMode: f.colorMode,
        paperSize: f.paperSize,
        duplex: f.duplex,
        shopPricingConfig: shop.pricingConfig,
      };
      const result = priceFile(pricingInput);
      const label = `${f.originalFilename} — ${f.copies}× (${f.colorMode}/${f.paperSize}${f.duplex ? '/duplex' : ''})`;
      page.drawText(label, { x, y: cursor, size: 10, font });
      page.drawText(formatINRFromPaise(result.totalPaise), { x: 420, y: cursor, size: 10, font });
      cursor -= 14;
      for (const li of result.lineItems) {
        const sign = li.subtotalPaise < 0 ? '-' : '';
        page.drawText(`  ${li.label}`, { x: x + 8, y: cursor, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
        page.drawText(`${sign}${formatINRFromPaise(Math.abs(li.subtotalPaise))}`, { x: 420, y: cursor, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
        cursor -= 12;
      }
      cursor -= 4;
    }

    cursor -= 10;
    page.drawText('Total', { x, y: cursor, size: 14, font: bold });
    page.drawText(formatINRFromPaise(order.totalAmountPaise), { x: 420, y: cursor, size: 14, font: bold });
    page.drawText(`Paid via ${order.paymentProvider ?? 'UPI'} · UTR ${order.paymentUtr ?? 'n/a'}`, { x, y: cursor - 22, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('Thank you! Files auto-deleted after collection.', { x, y: 60, size: 9, font, color: rgb(0.4, 0.4, 0.4) });

    const bytes = await doc.save();
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="receipt-${order.customerToken}.pdf"`,
      },
    });
  } catch (cause) {
    const { toAppError, fail } = await import('@/lib/api/envelope');
    return fail(toAppError(cause));
  }
}

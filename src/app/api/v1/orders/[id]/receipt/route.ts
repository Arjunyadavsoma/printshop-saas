import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { repos } from '@/lib/repositories';
import { NotFoundError } from '@platform/core/errors';
import { formatINRFromPaise } from '@platform/utils';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { withRateLimit } from '@/lib/api/with-auth';

/** GET /api/v1/orders/:id/receipt — downloadable PDF receipt.
 *
 * SEC-001 fix: behind withOrderAccess — caller must prove they know the
 * order's `customerToken` via the X-Order-Token header or the `?t=` query
 * param. Receipts are opened as a browser NAVIGATION (the customer
 * clicks a Download receipt link), so the browser cannot send a custom
 * header — the customer tracking page must construct the URL with
 * `?t=<token>`. withOrderAccess already reads the `?t=` fallback.
 *
 * Rate-limited (30/min) — FIND-027 fix: prevents brute-force token guessing.
 *
 * H8 fix: the receipt previously re-priced each file by calling
 * `priceFile()` against the shop's CURRENT pricing config. This was wrong
 * for two reasons:
 *   1. If the shopkeeper changed their prices between order placement and
 *      receipt download, the receipt showed different line totals than
 *      what the customer was actually charged.
 *   2. The receipt's per-file line total could disagree with the order's
 *      `totalAmountPaise`, which is what the payment gateway captured.
 * Now the receipt renders the persisted `file.pricePaise` (captured at
 * order placement time). If `pricePaise` is null/0 on a placeholder /
 * unpriced file, the line shows "Pending" instead of an amount.
 */
export const GET = withRateLimit('receipt', 30, 60,
  withOrderAccess<{ id: string }>(async (_req, _ctx, order) => {
  try {
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
      const label = `${f.originalFilename} — ${f.copies}× (${f.colorMode}/${f.paperSize}${f.duplex ? '/duplex' : ''})`;
      // H8 fix: render the PERSISTED price (captured at order placement),
      // not a re-calculation against the shop's current pricing config.
      // pricePaise === null/0 means the file is a placeholder / unpriced —
      // show "Pending" instead of misleading the customer with Rs 0.00.
      const hasPersistedPrice = typeof f.pricePaise === 'number' && f.pricePaise > 0;
      const priceText = hasPersistedPrice
        ? formatINRFromPaise(f.pricePaise)
        : 'Pending';
      page.drawText(label, { x, y: cursor, size: 10, font });
      page.drawText(priceText, { x: 420, y: cursor, size: 10, font });
      cursor -= 14;
      // No sub-line-items — those were a breakdown from the pricing engine
      // and would also need to be persisted to render authoritatively. The
      // canonical line total is the persisted `pricePaise`; the order's
      // `totalAmountPaise` is what was charged and matches the Total line.
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
}));

import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { toAppError, fail } from '@/lib/api/envelope';
import { getShopCustomerUrl } from '@/lib/api/origin';

/**
 * GET /api/v1/shops/me/sticker — a printable A4 sheet with the shop's
 * customer QR repeated as a sheet of stickers (so the shopkeeper can print
 * and stick them anywhere). Rendered as a real PDF via pdf-lib.
 *
 * The QR encodes the shop's customer URL on the CURRENT deployment (derived
 * from the request via getShopCustomerUrl) — so stickers stay valid when
 * the site moves to a new domain, as long as the shopkeeper re-downloads +
 * re-prints the sticker sheet after the move.
 *
 * M7 fix (sticker PDF empty when no logo):
 *
 * Two issues closed in this revision:
 *
 * 1. The previous route guarded on `shop.upiId` and threw `NotFoundError` if
 *    the shop had no UPI configured. But the sticker's QR encodes the shop's
 *    CUSTOMER URL (`getShopCustomerUrl(shop.slug, req)`), NOT a UPI deep
 *    link — `upiId` is never read anywhere else in the route. A newly-
 *    registered shop without a UPI ID (a valid state — the shopkeeper can
 *    add UPI later from /shop/settings) would click "Sticker PDF (A4)" and
 *    get a JSON 404 envelope back with `Content-Type: application/json`
 *    instead of the expected `application/pdf`. The browser, expecting a
 *    PDF download from the <a download> trigger, would show "couldn't load
 *    PDF" / a blank tab / a silently-failed download — visually identical
 *    to an "empty PDF". The bogus guard is removed: the sticker only needs
 *    a valid `shop.slug`, which is always present (it's a UNIQUE NOT NULL
 *    column set at registration).
 *
 * 2. The shop's `logoUrl` field was stored-but-never-rendered (per PERF-017
 *    in worklog.md). The sticker now EMBEDS the logo above the QR when
 *    `shop.logoUrl` is present and fetchable, with a per-cell graceful
 *    fallback: if the logo URL is null/empty, the fetch times out (4s), the
 *    response isn't an image, or `embedPng`/`embedJpg` throws on malformed
 *    bytes, the sticker renders text-only (exactly the previous layout).
 *    The sticker is therefore NEVER empty — worst case it's the same as
 *    today; best case it has the shop's logo above the QR.
 *
 * `logoUrl` is an arbitrary external URL pasted by the shopkeeper (no
 * upload route exists yet), so the fetch is wrapped in `AbortSignal.timeout`
 * + a content-type sniff + individual try/catch around each embed call.
 */
export const GET = withAuth(async (req, _ctx, principal) => {
  try {
    const shop = await repos.shops.getByOwner(principal.userId);
    const customerUrl = getShopCustomerUrl(shop.slug, req);
    const qrPng = await QRCode.toBuffer(customerUrl, { margin: 1, width: 300, type: 'png' });

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const qrImage = await doc.embedPng(qrPng);

    // ── M7 fix: embed the shop logo if available, with graceful fallback ──
    // The logo is fetched ONCE (not per-cell) and the embedded PDFImage is
    // reused across all 6 sticker cells. If anything goes wrong — null
    // logoUrl, fetch timeout, non-image content-type, corrupt bytes — we
    // silently fall back to `null` and the cell loop renders text-only.
    // This guarantees the PDF is NEVER empty because of a missing/broken
    // logo.
    const logoImage = await embedShopLogo(doc, shop.logoUrl);

    const page = doc.addPage([595, 842]); // A4 portrait, points
    const W = 595;
    // Sheet of 6 stickers, 3 columns × 2 rows.
    const cols = 3, rows = 2;
    const cellW = W / cols;
    const cellH = 260;
    const startY = 842 - 40;

    // Truncate the shop name if it's too wide for the 150pt QR cell. The
    // bold font's widthOfTextAtSize gives the precise rendered width; we
    // trim characters until it fits, then add an ellipsis if we trimmed.
    const fitShopName = (raw: string): string => {
      const max = 150;
      if (raw.length === 0) return '';
      if (bold.widthOfTextAtSize(raw, 11) <= max) return raw;
      const ellipsis = '…';
      const ellipsisW = bold.widthOfTextAtSize(ellipsis, 11);
      let trimmed = raw;
      while (trimmed.length > 1 && bold.widthOfTextAtSize(trimmed, 11) + ellipsisW > max) {
        trimmed = trimmed.slice(0, -1);
      }
      return trimmed + ellipsis;
    };
    const shopNameLabel = fitShopName(shop.name);

    for (let i = 0; i < cols * rows; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = c * cellW + (cellW - 150) / 2;
      const y = startY - r * cellH - 150;

      // ── Logo (optional, rendered ABOVE the QR) ──
      // Rendered only when `logoImage` is non-null. The logo is sized to
      // 50×50 pts and centered above the QR (10pt gap). When `logoImage`
      // is null (no logoUrl / fetch failed / embed failed), this block is
      // skipped entirely and the cell renders exactly as it did before
      // the M7 fix — the sticker is never empty.
      if (logoImage) {
        const logoSize = 50;
        const logoX = x + (150 - logoSize) / 2;
        const logoY = y + 150 + 10; // 10pt above the QR top
        page.drawImage(logoImage, { x: logoX, y: logoY, width: logoSize, height: logoSize });
      }

      page.drawImage(qrImage, { x, y, width: 150, height: 150 });
      page.drawText(shopNameLabel, {
        x: x + (150 - bold.widthOfTextAtSize(shopNameLabel, 11)) / 2,
        y: y - 16,
        size: 11,
        font: bold,
        color: rgb(0, 0, 0),
      });
      page.drawText('Scan to print', {
        x: x + (150 - font.widthOfTextAtSize('Scan to print', 9)) / 2,
        y: y - 30,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
    const bytes = await doc.save();
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${shop.slug}-stickers.pdf"`,
      },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner', 'staff']);

/**
 * Fetch + embed the shop logo into a PDFDocument, returning the embedded
 * image (reusable across pages) or `null` if the logo is unavailable or
 * broken.
 *
 * M7 fix: every failure mode returns `null` (never throws) so the caller's
 * sticker render loop can branch on `if (logoImage)` and render text-only
 * when there's no logo. This makes the "empty PDF when no logo" bug
 * structurally impossible.
 *
 * Failure modes handled:
 *   - `logoUrl` is null / empty / not a string → null
 *   - URL is malformed (new URL() throws) → null
 *   - Fetch times out (4s AbortSignal) → null
 *   - HTTP status non-OK → null
 *   - Content-Type isn't image/png or image/jpeg → null
 *   - `embedPng` / `embedJpg` throws on malformed bytes → null
 *
 * The 4-second timeout matters because `logoUrl` is an arbitrary external
 * URL pasted by the shopkeeper (no upload route exists) — it could point
 * at a slow server, a dead domain, or a CORS-blocked origin. Without the
 * timeout, a single slow logo fetch would block the entire PDF generation
 * (and the shopkeeper's download) indefinitely.
 */
async function embedShopLogo(doc: PDFDocument, logoUrl: string | null | undefined): Promise<PDFImage | null> {
  if (!logoUrl || typeof logoUrl !== 'string' || logoUrl.trim().length === 0) {
    return null;
  }
  try {
    // Validate the URL early — a malformed string throws here, saving a
    // wasted fetch attempt.
    new URL(logoUrl);
  } catch {
    return null;
  }
  try {
    const res = await fetch(logoUrl, {
      signal: AbortSignal.timeout(4000),
      // `cache: 'no-store'` so a shopkeeper who updates their logo sees the
      // new one on the next sticker download (not a stale CDN cache).
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    // pdf-lib requires the right embed call per format — `embedPng` for PNG,
    // `embedJpg` for JPEG. Other formats (webp, gif, svg) aren't supported
    // by pdf-lib at all; return null so the sticker renders text-only.
    if (ct.includes('png')) {
      try {
        return await doc.embedPng(buf);
      } catch {
        return null;
      }
    }
    if (ct.includes('jpeg') || ct.includes('jpg')) {
      try {
        return await doc.embedJpg(buf);
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    // Network error, timeout, CORS — all collapse to "no logo".
    return null;
  }
}

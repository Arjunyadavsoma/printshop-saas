import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';

/**
 * GET /api/v1/s/[slug]/files/[fileId]?token=<orderToken>
 *
 * Customer-facing upload/file status (no login): the order's 128-bit token
 * is the credential. Returns the pipeline state plus signed thumbnail URLs
 * for the page grid. If the file has not been processed yet (background
 * conversion), thumbnails may be absent and status is `converting`.
 */
export const GET = withRateLimit<{ slug: string; fileId: string }>('file-status', 240, 60, async (_req: NextRequest, ctx: { params: Promise<{ slug: string; fileId: string }> }) => {
  try {
    const { slug, fileId } = await ctx.params;
    const token = _req.nextUrl.searchParams.get('token') ?? '';

    const shop = await getContainer().db.findOne<{ id: string }>('shop', { slug });
    if (!shop) throw new NotFoundError('Shop not found');
    const file = await repos.files.findById(fileId);
    if (!file) throw new NotFoundError('File not found');
    const order = await getContainer().db.findOne<{ id: string; shopId: string; customerToken: string }>('order', { id: file.orderId });
    if (!order || order.shopId !== shop.id || order.customerToken !== token) {
      // 404 (not 403) — do not reveal whether another customer's file exists.
      throw new NotFoundError('File not found');
    }

    const thumbs: Array<{ page: number; url: string }> = [];
    if (file.pdfStorageKey) {
      const pageCount = file.pageCount ?? 0;
      for (let p = 1; p <= Math.min(pageCount, 120); p++) {
        const key = file.storageKey.replace('/orig/', `/thumbs/${file.id}/`).replace(/\.[^.]+$/, `-${p}.png`);
        try {
          const url = await getContainer().storage.getPresignedDownloadUrl(key, 900);
          thumbs.push({ page: p, url });
        } catch { /* thumbnail missing — grid degrades to numbers */ }
      }
    }

    return ok({
      fileId: file.id,
      orderId: order.id,
      status: file.status,
      pageCount: file.pageCount,
      pageWidthPt: file.pageWidthPt,
      pageHeightPt: file.pageHeightPt,
      failReason: file.failReason ?? null,
      colorSuggestion: file.colorSuggestion ?? null,
      thumbnails: thumbs,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

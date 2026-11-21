import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { parsePageRange } from '@/lib/printing/page-range';
import { ValidationError, NotFoundError } from '@platform/core/errors';

/**
 * PUT /api/v1/s/[slug]/specs — attach the customer's print options to one
 * draft file. The pageRangeText is resolved server-side into pageModes
 * (source of truth); "skip" pages come only from the thumbnail grid.
 */
const BodySchema = z.object({
  orderId: z.string().uuid(),
  orderToken: z.string().min(8),
  fileId: z.string().uuid(),
  pageRangeText: z.string().max(200).default(''),
  copies: z.number().int().min(1).max(100),
  sides: z.enum(['SINGLE', 'DOUBLE']),
  pagesPerSheet: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.literal(9)]),
  paperSize: z.string().min(1).max(12),
  paperType: z.string().min(1).max(12).default('PLAIN'),
  collate: z.boolean().default(true),
  /** Explicit per-page overrides from the grid (color/bw/skip). */
  colorPages: z.array(z.number().int().positive()).max(2000).default([]),
  skipPages: z.array(z.number().int().positive()).max(2000).default([]),
});

export const PUT = withRateLimit('specs', 120, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    const { slug } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    const db = getContainer().db;
    const shop = await db.findOne<{ id: string }>('shop', { slug });
    if (!shop) throw new NotFoundError('Shop not found');
    const order = await db.findOne<{ id: string; customerToken: string; shopId: string; status: string }>('order', { id: body.orderId });
    if (!order || order.customerToken !== body.orderToken || order.shopId !== shop.id) {
      throw new NotFoundError('Order not found');
    }
    if (order.status !== 'draft') throw new ValidationError('Options can only be changed while the order is a draft.');
    const file = await repos.files.findByIdAndOrder(body.fileId, body.orderId);
    if (!file) throw new NotFoundError('File not found');
    const pageCount = file.pageCount ?? 0;
    if (pageCount === 0) throw new ValidationError('The file is still processing — wait for the page count before choosing options.');

    // resolve selected pages: range text ∩ [1..pageCount], minus skips
    const rangePages = body.pageRangeText.trim() === '' || body.pageRangeText.trim().toLowerCase() === 'all'
      ? Array.from({ length: pageCount }, (_, i) => i + 1)
      : parsePageRange(body.pageRangeText, pageCount);
    const skip = new Set(body.skipPages);
    const colorSet = new Set(body.colorPages);
    const pageModes = rangePages.map(p => ({
      page: p,
      mode: skip.has(p) ? 'skip' as const : colorSet.has(p) ? 'color' as const : 'bw' as const,
    }));

    const existing = await db.findOne<{ id: string }>('printSpec', { orderFileId: file.id });
    const data = {
      copies: body.copies,
      sides: body.sides,
      pagesPerSheet: body.pagesPerSheet,
      paperSize: body.paperSize,
      paperType: body.paperType,
      collate: body.collate,
      pageRangeText: body.pageRangeText,
      pageModes,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update('printSpec', { id: existing.id }, data);
    } else {
      await db.insert('printSpec', {
        id: crypto.randomUUID(),
        orderFileId: file.id,
        orientation: 'AUTO',
        scale: 'FIT',
        duplexEdge: 'long',
        createdAt: new Date(),
        ...data,
      });
    }
    return ok({ fileId: file.id, pageModes });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

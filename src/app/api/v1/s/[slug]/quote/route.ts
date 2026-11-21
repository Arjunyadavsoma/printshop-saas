import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { quoteOrder } from '@/lib/orders/order-flow';
import type { DraftFileSpec } from '@/lib/orders/order-flow';
import { NotFoundError } from '@platform/core/errors';

/**
 * POST /api/v1/s/[slug]/quote — stateless price computation (brief §4.4).
 * Every number the customer sees comes from HERE; the client never computes
 * money. Debounced re-quote on every option change.
 */
const BodySchema = z.object({
  files: z.array(z.object({
    fileId: z.string().uuid(),
    spec: z.object({
      pageModes: z.array(z.object({
        page: z.number().int().positive(),
        mode: z.enum(['color', 'bw', 'skip']),
      })).min(1).max(2000),
      copies: z.number().int().min(1).max(100),
      sides: z.enum(['SINGLE', 'DOUBLE']),
      pagesPerSheet: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.literal(9)]),
      paperSize: z.string().min(1).max(12),
      paperType: z.string().min(1).max(12),
      collate: z.boolean(),
    }),
  })).min(1).max(20),
  addonIds: z.array(z.string().uuid()).max(10),
  urgent: z.boolean().default(false),
});

export const POST = withRateLimit('quote', 120, 60, async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    const { slug } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    const shop = await getContainer().db.findOne<{ id: string }>('shop', { slug });
    if (!shop) throw new NotFoundError('Shop not found');

    const addonRows = await repos.addons.activeForShop(shop.id);
    const selected = addonRows.filter(a => body.addonIds.includes(a.id)).map(a => ({ addon: a as unknown as Parameters<typeof quoteOrder>[2][number]['addon'] }));

    const quote = await quoteOrder(shop.id, body.files as DraftFileSpec[], selected, body.urgent);
    return ok(quote);
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

import { withAuth } from '@/lib/api/with-auth';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { z } from 'zod';

const ReorderSchema = z.object({
  taskId: z.string().uuid(),
  beforeId: z.string().uuid().optional(),
  afterId: z.string().uuid().optional(),
  toTop: z.boolean().optional(),
}).refine(d => d.beforeId || d.afterId || d.toTop, { message: 'Must specify beforeId, afterId, or toTop' });

/** POST /api/v1/shop/queue/reorder */
export const POST = withAuth(async (req, _ctx, principal) => {
  try {
    const body = ReorderSchema.parse(await req.json());
    const { reorderTask } = await import('@/lib/queue/queue-service');
    await reorderTask(principal.shopId!, body.taskId, {
      beforeId: body.beforeId,
      afterId: body.afterId,
      toTop: body.toTop,
    });
    return ok({ reordered: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner', 'staff']);

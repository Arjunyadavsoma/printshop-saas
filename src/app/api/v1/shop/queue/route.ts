import { withAuth } from '@/lib/api/with-auth';
import { getQueue } from '@/lib/queue/queue-service';
import { ok, fail, toAppError } from '@/lib/api/envelope';

/** GET /api/v1/shop/queue — list tasks in queue order with executor labels. */
export const GET = withAuth(async (_req, _ctx, principal) => {
  try {
    const queue = await getQueue(principal.shopId!);
    return ok({ tasks: queue, count: queue.length });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner', 'staff']);

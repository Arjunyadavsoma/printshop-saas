import { withDeviceAuth } from '@/lib/api/with-auth';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { renewLease } from '@/lib/queue/claim-service';

/** POST /api/v1/agents/jobs/:id/lease/renew — renew the claim lease. */
export const POST = withDeviceAuth<{ id: string }>(async (_req, ctx, { agent }) => {
  try {
    const { id: taskId } = await ctx.params;
    const result = await renewLease(taskId, agent.id);
    return ok(result);
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

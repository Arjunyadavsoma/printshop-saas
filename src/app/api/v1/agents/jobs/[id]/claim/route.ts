import { withDeviceAuth } from '@/lib/api/with-auth';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { ForbiddenError } from '@platform/core/errors';
import { claimTask } from '@/lib/queue/claim-service';

/** POST /api/v1/agents/jobs/:id/claim — mobile agent claims a task. */
export const POST = withDeviceAuth<{ id: string }>(async (_req, ctx, { agent }) => {
  try {
    // Only MOBILE agents can claim tasks
    if ((agent as any).kind !== 'MOBILE') {
      throw new ForbiddenError('Only mobile agents can claim tasks');
    }
    const { id: taskId } = await ctx.params;
    const result = await claimTask(taskId, agent.id);
    return ok(result);
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

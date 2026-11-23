import { withAuth } from '@/lib/api/with-auth';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { z } from 'zod';
import { setPriority, holdTask, releaseTask, rerouteTask, reprintTask } from '@/lib/queue/queue-service';

const PrioritySchema = z.object({ priority: z.union([z.literal(0), z.literal(10)]) });
const RerouteSchema = z.object({ printerId: z.string().uuid() });

export const priority = withAuth<{ id: string }>(async (req, ctx, principal) => {
  try {
    const { id: taskId } = await ctx.params;
    const body = PrioritySchema.parse(await req.json());
    await setPriority(principal.shopId!, taskId, body.priority);
    return ok({ updated: true });
  } catch (cause) { return fail(toAppError(cause)); }
}, ['owner', 'staff']);

export const hold = withAuth<{ id: string }>(async (_req, ctx, principal) => {
  try {
    const { id: taskId } = await ctx.params;
    await holdTask(principal.shopId!, taskId);
    return ok({ held: true });
  } catch (cause) { return fail(toAppError(cause)); }
}, ['owner', 'staff']);

export const release = withAuth<{ id: string }>(async (_req, ctx, principal) => {
  try {
    const { id: taskId } = await ctx.params;
    await releaseTask(principal.shopId!, taskId);
    return ok({ released: true });
  } catch (cause) { return fail(toAppError(cause)); }
}, ['owner', 'staff']);

export const reroute = withAuth<{ id: string }>(async (req, ctx, principal) => {
  try {
    const { id: taskId } = await ctx.params;
    const body = RerouteSchema.parse(await req.json());
    await rerouteTask(principal.shopId!, taskId, body.printerId);
    return ok({ rerouted: true });
  } catch (cause) { return fail(toAppError(cause)); }
}, ['owner', 'staff']);

export const reprint = withAuth<{ id: string }>(async (_req, ctx, principal) => {
  try {
    const { id: taskId } = await ctx.params;
    await reprintTask(principal.shopId!, taskId);
    return ok({ reprinted: true });
  } catch (cause) { return fail(toAppError(cause)); }
}, ['owner', 'staff']);

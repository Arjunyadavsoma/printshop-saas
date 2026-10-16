import { z } from 'zod';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

const HeartbeatSchema = z.object({
  printerName: z.string().max(200).optional(),
  version: z.string().max(40).optional(),
  os: z.string().max(40).optional(),
});

/**
 * POST /api/v1/agents/heartbeat — device-token-authed. Refreshes presence so
 * the dispatch path knows an agent is reachable, and reports the local
 * printer name / agent version for the dashboard.
 */
export const POST = withDeviceAuth(async (req, _ctx, { agent }) => {
  const body = HeartbeatSchema.parse(await req.json().catch(() => ({})));
  await repos.printAgents.update(agent.id, {
    isOnline: true,
    lastSeenAt: new Date(),
    printerName: body.printerName ?? agent.printerName,
    version: body.version ?? agent.version,
    os: body.os ?? agent.os,
  });
  return ok({ agentId: agent.id, online: true, ts: new Date().toISOString() });
});

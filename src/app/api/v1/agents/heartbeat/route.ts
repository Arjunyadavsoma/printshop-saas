import { z } from 'zod';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { publishQueueEvent, QUEUE_EVENTS } from '@/lib/queue/queue-events';
import { shopChannel } from '@platform/core/interfaces';

const HeartbeatSchema = z.object({
  printerName: z.string().max(200).optional(),
  version: z.string().max(40).optional(),
  os: z.string().max(40).optional(),
  // ── Mobile executor / queue v2 (additive) ──
  /** App version reported by the agent (overrides the legacy `version`
   *  field when present; mobile apps use this). */
  appVersion: z.string().max(40).optional(),
  /** android | ios | windows | linux | … */
  platform: z.string().max(40).optional(),
  /** Capabilities array — stringified into the capabilities column. */
  capabilities: z.union([z.array(z.string().max(60)).max(50), z.string().max(2048)]).optional(),
  /** Human-readable device name (the dashboard shows this). */
  agentName: z.string().max(120).optional(),
  /** Online/offline state of any attached printers (best-effort). */
  printersOnline: z.number().int().min(0).max(50).optional(),
});

/**
 * POST /api/v1/agents/heartbeat — device-token-authed. Refreshes presence so
 * the dispatch path knows an agent is reachable, and reports the local
 * printer name / agent version / mobile executor fields for the dashboard.
 *
 * v2 additions (all optional, additive — old clients keep working):
 *   - appVersion, platform, capabilities, agentName
 *
 * Every successful heartbeat publishes an `agent.status` realtime event so
 * the dashboard's device list updates live.
 */
export const POST = withDeviceAuth(async (req, _ctx, { agent, shopId }) => {
  const body = HeartbeatSchema.parse(await req.json().catch(() => ({})));
  const capabilitiesStr = body.capabilities === undefined
    ? undefined
    : Array.isArray(body.capabilities)
      ? JSON.stringify(body.capabilities)
      : body.capabilities;
  await repos.printAgents.update(agent.id, {
    isOnline: true,
    lastSeenAt: new Date(),
    printerName: body.printerName ?? agent.printerName,
    version: body.version ?? agent.version,
    os: body.os ?? agent.os,
    appVersion: body.appVersion ?? agent.appVersion ?? null,
    platform: body.platform ?? agent.platform ?? null,
    capabilities: capabilitiesStr ?? agent.capabilities ?? '[]',
    agentName: body.agentName ?? agent.agentName ?? null,
  });

  // Realtime presence ping — the dashboard's device list updates live.
  await publishQueueEvent(shopId, QUEUE_EVENTS.agentStatus, {
    agentId: agent.id,
    online: true,
    kind: agent.kind ?? 'PC',
    ts: new Date().toISOString(),
  });
  void getContainer().realtime
    .publish(shopChannel(shopId), 'agent.heartbeat', { agentId: agent.id })
    .catch(() => {});

  return ok({ agentId: agent.id, online: true, ts: new Date().toISOString() });
});

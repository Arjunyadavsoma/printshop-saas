import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';
import { getContainer } from '@/lib/container';
import { shopChannel } from '@platform/core/interfaces';

/**
 * DELETE /api/v1/agents/{id} — shop-owner-authed. Revokes a print agent
 * (desktop client or Bun/TS CLI) by deleting its PrintAgent row.
 *
 * This immediately invalidates the device token — the HMAC hash is gone,
 * so `withDeviceAuth` will reject all future calls from that device.
 *
 * Also returns any queued print jobs assigned to the agent back to the
 * queue (sets `agentId = null`) so another agent can pick them up.
 *
 * Use cases:
 * - Shopkeeper revokes a lost/stolen PC
 * - Shopkeeper removes an old agent after replacing hardware
 * - PrintEXE "Revoke this PC" button calls this endpoint
 *
 * Audit-logged. Realtime notification published so connected dashboards
 * refresh their agent list.
 */
export const DELETE = withAuth(async (req, ctx, principal) => {
  const { id: agentId } = await ctx.params;
  const shop = await repos.shops.getByOwner(principal.userId);

  // Verify the agent belongs to this shop (tenant isolation)
  const agent = await repos.printAgents.findByIdAndShop(agentId, shop.id);
  if (!agent) {
    throw new NotFoundError('Print agent not found in your shop.');
  }

  const container = getContainer();

  // Return any queued jobs assigned to this agent to the queue — set
  // agentId=null so another agent can claim them. Jobs in 'printing'
  // state are left alone (they may have already spooled to the printer).
  const activeJobs = await container.db.findMany('PrintJob', {
    agentId: agent.id,
    status: 'queued',
  });
  for (const job of activeJobs) {
    await container.db.update('PrintJob', { id: job.id }, {
      agentId: null,
      updatedAt: new Date(),
    });
  }

  // Delete the agent row — this revokes the token (hash is gone)
  await container.db.delete('PrintAgent', { id: agent.id, shopId: shop.id });

  // Audit log
  await container.db.insert('AuditLog', {
    id: crypto.randomUUID(),
    shopId: shop.id,
    userId: principal.userId,
    action: 'agent.revoke',
    entityType: 'PrintAgent',
    entityId: agent.id,
    metadata: JSON.stringify({
      agentName: agent.name,
      cancelledJobs: activeJobs.length,
    }),
    ip: req.headers.get('x-forwarded-for') || null,
    createdAt: new Date(),
  });

  // Realtime notification — dashboards refresh agent list
  void container.realtime.publish(shopChannel(shop.id), 'agent.revoked', {
    agentId: agent.id,
    agentName: agent.name,
    cancelledJobs: activeJobs.length,
  }).catch(() => { /* best-effort */ });

  return ok({
    agentId: agent.id,
    agentName: agent.name,
    revoked: true,
    cancelledJobs: activeJobs.length,
    message: `Agent "${agent.name}" revoked. ${activeJobs.length} queued job(s) returned to the queue.`,
  });
});

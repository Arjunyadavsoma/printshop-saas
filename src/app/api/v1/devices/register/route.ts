import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { getOrCreateSyncState } from '@/lib/repositories/sync.repository';

const RegisterDeviceSchema = z.object({
  deviceId: z.string().uuid(),
  deviceName: z.string().min(1).max(120),
  platform: z.string().max(40).optional(),
  appVersion: z.string().max(40).optional(),
  machineId: z.string().max(200).optional(),
});

/**
 * POST /api/v1/devices/register — JWT-authed (owner).
 *
 * Registers a PrintEXE desktop device for sync. The `deviceId` MUST already
 * correspond to a registered PrintAgent for the owner's shop — the desktop
 * app first calls POST /api/v1/agents/register (which mints a device token),
 * then calls this endpoint to opt the agent into bidirectional sync.
 *
 * Returns the device's current sync cursor. The device authenticates
 * subsequent sync endpoints with the SAME device token returned by
 * /agents/register (the PrintAgent tokenHash is the sync credential).
 *
 * Idempotent: re-registering the same deviceId just returns the existing
 * cursor (the underlying `getOrCreateSyncState` upserts).
 */
export const POST = withAuth(async (req, _ctx, principal) => {
  const body = RegisterDeviceSchema.parse(await req.json());
  const shop = await repos.shops.getByOwner(principal.userId);

  // Verify the deviceId corresponds to a registered PrintAgent for THIS shop.
  // This is the tenant boundary — a device from another shop cannot register
  // against our shop's sync state.
  const agent = await repos.printAgents.findByIdAndShop(body.deviceId, shop.id);
  if (!agent) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message:
            'Device not found. Register a print agent first via POST /api/v1/agents/register.',
        },
      },
      { status: 404 },
    );
  }

  // Optional: record the device's platform/version metadata on the
  // PrintAgent row. The agent's heartbeat also reports these, so this
  // is best-effort — we don't fail the registration if it doesn't apply.
  if (body.platform || body.appVersion) {
    try {
      await repos.printAgents.update(agent.id, {
        os: body.platform ?? agent.os,
        version: body.appVersion ?? agent.version,
      });
    } catch {
      /* best-effort — the sync registration still succeeds */
    }
  }

  const state = await getOrCreateSyncState(shop.id, body.deviceId);

  return ok({
    deviceId: body.deviceId,
    syncCursor: state.syncCursor,
    lastSyncAt: state.lastSyncAt,
    lastPushAt: state.lastPushAt,
    shopId: shop.id,
    agentName: agent.name,
    message:
      'Device registered for sync. Use the device token (from /api/v1/agents/register) for sync endpoints.',
  });
});

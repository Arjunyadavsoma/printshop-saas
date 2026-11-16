import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';
import { shopChannel } from '@platform/core/interfaces';

/**
 * Per-device management routes for the shopkeeper portal's "Devices" page.
 *
 *   GET    /api/v1/shops/me/devices/:deviceId            — detail + recent commands
 *   PATCH  /api/v1/shops/me/devices/:deviceId            — rename / enable / disable
 *   DELETE /api/v1/shops/me/devices/:deviceId            — revoke (delete + requeue jobs)
 *
 * Every handler is shop-scoped via `principal.shopId`: a device that doesn't
 * belong to the caller's shop is reported as 404 (not 403) to avoid leaking
 * the existence of other tenants' devices.
 */

interface PrintAgentRow {
  id: string;
  shopId: string;
  name: string;
  tokenHash: string;
  lastSeenAt: Date | null;
  printerName: string | null;
  isOnline: boolean;
  version: string | null;
  os: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface DeviceCommandRow {
  id: string;
  shopId: string;
  agentId: string;
  commandType: string;
  payload: string;
  status: string;
  initiatedBy: string;
  result: string | null;
  idempotencyKey: string;
  expiresAt: Date;
  deliveredAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Resolve the device row, tenant-scoped, or throw 404. */
async function requireDevice(shopId: string, deviceId: string): Promise<PrintAgentRow> {
  const row = await getContainer().db.findOne<PrintAgentRow>('printAgent', {
    id: deviceId,
    shopId,
  });
  if (!row) throw new NotFoundError('Device not found in your shop.');
  return row;
}

/** Parse a JSON column defensively. */
function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * GET /api/v1/shops/me/devices/:deviceId — owner/staff.
 *
 * Returns the device's full state plus the 20 most recent commands addressed
 * to it (any status), so the shopkeeper can audit what was sent and the
 * outcome of each.
 */
export const GET = withAuth(async (_req, ctx, principal) => {
  if (!principal.shopId) throw new NotFoundError('Device not found in your shop.');
  const { deviceId } = await ctx.params;
  const device = await requireDevice(principal.shopId, deviceId);

  const db = getContainer().db;
  const commandRows = await db.findMany<DeviceCommandRow>(
    'deviceCommand',
    { agentId: device.id },
    { order: ['createdAt', 'desc'], limit: 20 },
  );

  return ok({
    device: {
      id: device.id,
      name: device.name,
      isOnline: device.isOnline,
      isEnabled: device.isEnabled,
      lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
      printerName: device.printerName,
      version: device.version,
      os: device.os,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    },
    commands: commandRows.map((c) => ({
      id: c.id,
      commandType: c.commandType,
      status: c.status,
      payload: safeParse(c.payload),
      result: safeParse(c.result),
      initiatedBy: c.initiatedBy,
      expiresAt: c.expiresAt.toISOString(),
      deliveredAt: c.deliveredAt ? c.deliveredAt.toISOString() : null,
      executedAt: c.executedAt ? c.executedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}, ['owner', 'staff']);

const PatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.isEnabled !== undefined, {
    message: 'Provide at least one of: name, isEnabled.',
  });

/**
 * PATCH /api/v1/shops/me/devices/:deviceId — owner only.
 *
 * Rename a device and/or enable/disable it. Disabling a device leaves the
 * PrintAgent row in place (so the dashboard still lists it + its history)
 * but `withDeviceAuth` rejects its token — a soft pause. Use DELETE to fully
 * revoke (delete) a device.
 */
export const PATCH = withAuth(async (req, ctx, principal) => {
  if (!principal.shopId) throw new NotFoundError('Device not found in your shop.');
  const { deviceId } = await ctx.params;
  const device = await requireDevice(principal.shopId, deviceId);

  const body = PatchSchema.parse(await req.json().catch(() => ({} as unknown)));

  const patch: Partial<PrintAgentRow> = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.isEnabled !== undefined) patch.isEnabled = body.isEnabled;

  await getContainer().db.update('printAgent', { id: device.id }, patch);

  await repos.audit.log({
    shopId: principal.shopId,
    userId: principal.userId,
    action: 'device.update',
    entityType: 'PrintAgent',
    entityId: device.id,
    metadata: {
      name: body.name ?? null,
      isEnabled: body.isEnabled ?? null,
      previousName: device.name,
      previousIsEnabled: device.isEnabled,
    },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  return ok({
    id: device.id,
    name: patch.name ?? device.name,
    isEnabled: patch.isEnabled ?? device.isEnabled,
    updatedAt: patch.updatedAt!.toISOString(),
  });
}, ['owner']);

/**
 * DELETE /api/v1/shops/me/devices/:deviceId — owner only.
 *
 * Revokes a device: deletes the PrintAgent row (so its token hash is gone and
 * `withDeviceAuth` rejects all future calls from it) and returns any queued
 * PrintJobs assigned to it back to the queue (agentId=null) so another device
 * can claim them. Jobs already in 'printing' are left alone (they may have
 * already spooled to the printer).
 *
 * Audit-logged + a realtime event is published so connected dashboards
 * refresh their device list immediately.
 */
export const DELETE = withAuth(async (req, ctx, principal) => {
  if (!principal.shopId) throw new NotFoundError('Device not found in your shop.');
  const { deviceId } = await ctx.params;
  const shopId = principal.shopId;
  const device = await requireDevice(shopId, deviceId);

  const container = getContainer();

  // Return any queued jobs assigned to this device to the queue — set
  // agentId=null so another device can claim them. Jobs in 'printing'
  // are left alone (they may have already spooled to the printer).
  const activeJobs = await container.db.findMany<{ id: string }>('printJob', {
    agentId: device.id,
    status: 'queued',
  });
  for (const job of activeJobs) {
    await container.db.update('printJob', { id: job.id }, {
      agentId: null,
      updatedAt: new Date(),
    });
  }

  // Delete the agent row — this revokes the token (hash is gone).
  await container.db.delete('printAgent', { id: device.id, shopId });

  // Audit log. Never log the token hash.
  await container.db.insert('auditLog', {
    id: crypto.randomUUID(),
    shopId,
    userId: principal.userId,
    action: 'device.revoke',
    entityType: 'PrintAgent',
    entityId: device.id,
    metadata: JSON.stringify({
      deviceName: device.name,
      cancelledJobs: activeJobs.length,
    }),
    ip: req.headers.get('x-forwarded-for') || null,
    createdAt: new Date(),
  });

  // Realtime notification — dashboards refresh device list.
  void container.realtime
    .publish(shopChannel(shopId), 'device.revoked', {
      agentId: device.id,
      deviceName: device.name,
      cancelledJobs: activeJobs.length,
    })
    .catch(() => {
      /* best-effort */
    });

  return ok({
    id: device.id,
    name: device.name,
    revoked: true,
    cancelledJobs: activeJobs.length,
    message: `Device "${device.name}" revoked. ${activeJobs.length} queued job(s) returned to the queue.`,
  });
}, ['owner']);

import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';

/**
 * GET /api/v1/shops/me/devices — shopkeeper-authed.
 *
 * Lists every PrintAgent (PrintEXE companion device) registered for the
 * caller's shop, with its online presence, last-seen timestamp, reported
 * version / printer name, and enabled/disabled flag.
 *
 * The dashboard's "Devices" page renders this list; the shopkeeper uses it to
 * confirm a companion is reachable, rename a device, or revoke a lost/stolen
 * PC (DELETE /api/v1/shops/me/devices/:deviceId).
 *
 * `isEnabled=false` means the shopkeeper disabled the device without deleting
 * it — `withDeviceAuth` should treat disabled agents as rejected (the check
 * lives on the auth wrapper so the gate is enforced on every device call).
 */

/** Raw printAgent row including the isEnabled column (the domain type omits it). */
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

interface DeviceDto {
  id: string;
  name: string;
  isOnline: boolean;
  isEnabled: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
  version: string | null;
  os: string | null;
  createdAt: string;
}

export const GET = withAuth(async (_req, _ctx, principal) => {
  if (!principal.shopId) {
    return ok({ devices: [] as DeviceDto[] });
  }

  const rows = await getContainer().db.findMany<PrintAgentRow>(
    'printAgent',
    { shopId: principal.shopId },
    { order: ['createdAt', 'desc'] },
  );

  const devices: DeviceDto[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    isOnline: r.isOnline,
    isEnabled: r.isEnabled,
    lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
    printerName: r.printerName,
    version: r.version,
    os: r.os,
    createdAt: r.createdAt.toISOString(),
  }));

  // Touch the shop repo so the owner-scoped shop lookup still runs — this
  // enforces the "user still owns a shop" invariant even when principal.shopId
  // is already populated (defence against a stale JWT after a shop transfer).
  await repos.shops.getByOwner(principal.userId);

  return ok({ devices });
}, ['owner', 'staff']);

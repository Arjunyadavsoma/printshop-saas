import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { withRateLimit } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { hashDeviceToken } from '@/lib/api/device-token';
import { isEntitled } from '@/lib/api/entitlements';
import { AppError, UnauthorizedError, NotFoundError } from '@platform/core/errors';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/v1/companion/pair — UNAUTHENTICATED.
 *
 * The pairing ticket IS the auth. The PrintEXE companion app calls this with
 * the ticket the shopkeeper minted via /api/v1/companion/pairing/begin; on
 * success it receives a long-lived device token it then uses for all
 * subsequent authenticated device calls (heartbeat, command polling, job
 * claiming) via `withDeviceAuth`.
 *
 * Flow:
 *   1. Validate body (ticket, deviceName, optional version/os/printerName).
 *   2. SHA-256 hash the presented ticket, look up PairingTicket by ticketHash.
 *   3. Reject if missing (invalid ticket), expired, or not 'active'.
 *   4. Atomically consume: UPDATE pairingTicket SET status='consumed',
 *      consumedAt=now WHERE id=? AND status='active'. First-wins — if 0 rows
 *      updated, another companion beat us; return 409.
 *   5. Mint a cryptographically random device token (32 bytes hex). Store ONLY
 *      its hash as printAgent.tokenHash — the plaintext token is returned ONCE.
 *      The hash uses the versioned HMAC scheme from '@/lib/api/device-token'
 *      (the same scheme `withDeviceAuth` verifies), so the freshly-minted
 *      token authenticates immediately.
 *   6. Link the ticket to the new agent (agentId) + persist device metadata.
 *   7. Audit-log the pairing (shopId, agentId, deviceName — never the token).
 *
 * Rate-limited to 10/minute per source IP to blunt ticket-guessing attempts
 * (each guess is a SHA-256 lookup that misses for ~all guesses).
 */

const PairSchema = z.object({
  ticket: z.string().length(64, 'ticket must be 64 hex chars'),
  deviceName: z.string().min(1).max(120),
  version: z.string().max(40).optional(),
  os: z.string().max(40).optional(),
  printerName: z.string().max(200).optional(),
});

/** Ticket row shape we read from the pairingTicket table. */
interface PairingTicketRow {
  id: string;
  shopId: string;
  agentId: string | null;
  createdByUserId: string;
  ticketHash: string;
  status: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  deviceName: string | null;
  deviceMetadata: string | null;
}

export const POST = withRateLimit('pairing-consume', 10, 60, async (req: NextRequest): Promise<NextResponse> => {
  const body = PairSchema.parse(await req.json().catch(() => ({} as unknown)));

  // 1. Hash the presented ticket (SHA-256) and look up the stored ticket row.
  const ticketHash = createHash('sha256').update(body.ticket).digest('hex');
  const db = getContainer().db;
  const ticket = await db.findOne<PairingTicketRow>('pairingTicket', { ticketHash });

  if (!ticket) {
    // No matching ticket — do NOT reveal whether the ticket "exists"; treat
    // every miss the same as an expired/consumed one to avoid enumeration.
    throw new UnauthorizedError('Invalid or unknown pairing ticket.');
  }

  // 2. Expiry check (before the consume attempt so a clear error is returned).
  if (ticket.expiresAt.getTime() < Date.now()) {
    // Best-effort: flip the row to 'expired' so the dashboard reflects it.
    void db
      .update('pairingTicket', { id: ticket.id, status: 'active' }, { status: 'expired' })
      .catch(() => {});
    throw new UnauthorizedError('Pairing ticket has expired. Request a new one.');
  }

  // 3. Single-use check — only 'active' tickets can be consumed.
  if (ticket.status !== 'active') {
    throw new AppError(
      `Pairing ticket is not available (status: ${ticket.status}).`,
      'PAIRING_TICKET_UNAVAILABLE',
      409,
    );
  }

  // 4. Atomic first-wins consume: filter on { id, status: 'active' } so a
  //    concurrent consume by another companion produces 0 updated rows and
  //    we bail with 409 instead of double-issuing a device token.
  const now = new Date();
  const consumed = await db.update<PairingTicketRow>(
    'pairingTicket',
    { id: ticket.id, status: 'active' },
    { status: 'consumed', consumedAt: now },
  );
  if (consumed.length === 0) {
    // Lost the race — another request consumed it between our read and update.
    throw new AppError(
      'Pairing ticket was just consumed by another request.',
      'PAIRING_TICKET_CONSUMED',
      409,
    );
  }

  // 5. multi_device entitlement re-check at CONSUME time. The gate in
  //    /pairing/begin runs at ticket MINT time; two shopkeepers (or two
  //    tabs) can mint tickets concurrently when the shop has zero devices,
  //    so consuming both would create two "first" devices. Re-checking here
  //    — plus the post-insert over-limit disable below — makes the plan
  //    limit hold even under concurrent pairing.
  const shopAgents = await repos.printAgents.listByShop(ticket.shopId);
  const enabledDeviceCount = shopAgents.filter((d) => d.isEnabled !== false).length;
  if (enabledDeviceCount >= 1 && !(await isEntitled(ticket.shopId, 'multi_device'))) {
    throw new AppError(
      'ENTITLEMENT_REQUIRED: multi_device — your current plan supports one paired Windows device. Upgrade the subscription to connect more.',
      'ENTITLEMENT_REQUIRED',
      403,
    );
  }

  // 6. Mint the long-lived device token + create the PrintAgent.
  //    The token hash MUST match withDeviceAuth's scheme (versioned HMAC —
  //    see '@/lib/api/device-token') so the companion can authenticate
  //    immediately after pairing.
  const deviceToken = randomBytes(32).toString('hex');
  const tokenHash = hashDeviceToken(deviceToken);

  const agentRow = await db.insert<{
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
  }>('printAgent', {
    id: crypto.randomUUID(),
    shopId: ticket.shopId,
    name: body.deviceName,
    tokenHash,
    lastSeenAt: now,
    printerName: body.printerName ?? null,
    isOnline: true, // the companion is clearly online — it just paired
    version: body.version ?? null,
    os: body.os ?? null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  // 6b. Close the concurrent-pairing race deterministically: re-count AFTER
  //     the insert. If the shop now exceeds its entitlement, disable the
  //     device we just created and reject the pairing — the OTHER device
  //     (already enabled before this request started) keeps working, and no
  //     over-limit device can authenticate.
  const afterInsert = await repos.printAgents.listByShop(ticket.shopId);
  const enabledAfter = afterInsert.filter((d) => d.isEnabled !== false).length;
  if (enabledAfter > 1 && !(await isEntitled(ticket.shopId, 'multi_device'))) {
    await db.update('printAgent', { id: agentRow.id }, { isEnabled: false, isOnline: false });
    await repos.audit.log({
      shopId: ticket.shopId,
      userId: ticket.createdByUserId,
      action: 'device.limit_disabled',
      entityType: 'PrintAgent',
      entityId: agentRow.id,
      metadata: { deviceName: body.deviceName, reason: 'multi_device entitlement exceeded by concurrent pairing' },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });
    throw new AppError(
      'ENTITLEMENT_REQUIRED: multi_device — a second device was disabled because your plan supports one paired Windows device. Upgrade the subscription to connect more.',
      'ENTITLEMENT_REQUIRED',
      403,
    );
  }

  // 6. Link the ticket → agent + persist the device metadata the companion
  //    reported (for the dashboard's "Devices" list).
  await db.update(
    'pairingTicket',
    { id: ticket.id },
    {
      agentId: agentRow.id,
      deviceName: body.deviceName,
      deviceMetadata: JSON.stringify({
        version: body.version ?? null,
        os: body.os ?? null,
        printerName: body.printerName ?? null,
      }),
    },
  );

  // 7. Resolve the shop name for the response + audit the pairing.
  const shop = await repos.shops.findById(ticket.shopId);
  if (!shop) {
    // The ticket referenced a shop that no longer exists — undo the pairing.
    await db.delete('printAgent', { id: agentRow.id });
    throw new NotFoundError('Shop no longer exists for this pairing ticket.');
  }

  await repos.audit.log({
    shopId: shop.id,
    userId: ticket.createdByUserId,
    action: 'device.pair',
    entityType: 'PrintAgent',
    entityId: agentRow.id,
    metadata: {
      deviceName: body.deviceName,
      version: body.version ?? null,
      os: body.os ?? null,
      printerName: body.printerName ?? null,
      ticketId: ticket.id,
    },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  // The device token is returned ONCE — the companion must store it.
  return ok({
    agentId: agentRow.id,
    deviceToken,
    shopId: shop.id,
    shopName: shop.name,
    protocolVersion: 1,
    warning: 'Store this deviceToken securely — it is shown only once.',
  });
});

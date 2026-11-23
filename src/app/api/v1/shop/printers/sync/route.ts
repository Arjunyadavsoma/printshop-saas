import { z } from 'zod';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { publishQueueEvent, QUEUE_EVENTS } from '@/lib/queue/queue-events';
import { shopChannel } from '@platform/core/interfaces';

/**
 * POST /api/v1/shop/printers/sync — device-token-authed.
 *
 * The agent reports the printers it can reach + the paths to each (a
 * Windows queue name on PC, a LAN IPP URI on mobile). The server
 * reconciles PrinterPath rows: existing paths are updated with
 * `lastSeenAt` + `status`; new paths are inserted; missing paths are
 * left alone (their status will be updated by the next sync from the
 * agent that owns them — never auto-expired, since a transient offline
 * state should not delete a path).
 *
 * Printers are merged by `printerUuid` when provided (IPP printer-uuid or
 * mDNS UUID). When no UUID is provided, a new Printer row is created per
 * (shopId, systemName) — matching the legacy behaviour.
 *
 * Body:
 *   {
 *     printers: [
 *       {
 *         systemName: string,
 *         displayName?: string,
 *         printerUuid?: string,
 *         supportsColor?: boolean,
 *         supportsDuplex?: boolean,
 *         paperSizes?: string[],
 *         paths: [
 *           {
 *             kind: 'WINDOWS_QUEUE' | 'LAN_IPP' | 'RAW9100',
 *             uri: string,
 *             status?: 'online' | 'offline' | 'error' | 'unknown',
 *             capabilities?: object
 *           }
 *         ]
 *       }
 *     ]
 *   }
 */
const PathSchema = z.object({
  kind: z.enum(['WINDOWS_QUEUE', 'LAN_IPP', 'RAW9100']),
  uri: z.string().min(1).max(500),
  status: z.enum(['online', 'offline', 'error', 'unknown']).default('unknown'),
  capabilities: z.record(z.string(), z.unknown()).default({}),
});

const PrinterSyncSchema = z.object({
  systemName: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  printerUuid: z.string().max(200).optional(),
  supportsColor: z.boolean().default(false),
  supportsDuplex: z.boolean().default(false),
  paperSizes: z.array(z.string()).default(['A4']),
  paths: z.array(PathSchema).default([]),
});

const SyncSchema = z.object({
  printers: z.array(PrinterSyncSchema).max(50),
});

interface PrinterRow {
  id: string;
  shopId: string;
  agentId: string | null;
  systemName: string;
  displayName: string;
  supportsColor: boolean;
  supportsDuplex: boolean;
  paperSizes: string[];
  enabled: boolean;
  status: string;
  printerUuid: string | null;
}

interface PrinterPathRow {
  id: string;
  printerId: string;
  agentId: string;
  kind: string;
  uri: string;
  lastSeenAt: Date | null;
  status: string;
  capabilities: string;
  createdAt: Date;
  updatedAt: Date;
}

export const POST = withDeviceAuth(async (req, _ctx, { agent, shopId }) => {
  const body = SyncSchema.parse(await req.json().catch(() => ({ printers: [] })));
  const db = getContainer().db;
  const now = new Date();

  const synced: Array<{ printerId: string; systemName: string; paths: Array<{ id: string; kind: string; uri: string }> }> = [];

  for (const p of body.printers) {
    // Resolve or create the Printer row.
    // 1. Try by printerUuid (same physical printer via different routes).
    // 2. Try by (shopId, systemName) — the legacy key.
    // 3. Otherwise create a new row.
    let printer = await db.findOne<PrinterRow>('printer', { shopId, systemName: p.systemName });
    if (!printer && p.printerUuid) {
      printer = await db.findOne<PrinterRow>('printer', { shopId, printerUuid: p.printerUuid });
    }
    if (!printer) {
      printer = await db.insert<PrinterRow>('printer', {
        id: crypto.randomUUID(),
        shopId,
        agentId: agent.id,
        systemName: p.systemName,
        displayName: p.displayName ?? p.systemName,
        supportsColor: p.supportsColor,
        supportsDuplex: p.supportsDuplex,
        paperSizes: p.paperSizes,
        isDefaultColor: false,
        isDefaultBw: false,
        status: 'OFFLINE',
        statusDetail: null,
        speedPpm: 20,
        pagesPrintedToday: 0,
        counterDate: null,
        lastSeenAt: now,
        enabled: true,
        printerUuid: p.printerUuid ?? null,
        createdAt: now,
        updatedAt: now,
      } as never);
    } else {
      // Update display name + capabilities + lastSeenAt. Do NOT clobber
      // `enabled` — that's a shopkeeper-controlled flag.
      await db.update('printer', { id: printer.id }, {
        displayName: p.displayName ?? printer.displayName,
        supportsColor: p.supportsColor,
        supportsDuplex: p.supportsDuplex,
        paperSizes: p.paperSizes,
        lastSeenAt: now,
        agentId: agent.id,
        printerUuid: p.printerUuid ?? printer.printerUuid,
        updatedAt: now,
      });
    }

    // Reconcile each path. The unique constraint on (printerId, agentId, kind)
    // means at most one row per (printer, agent, kind) trio — upsert by
    // finding + updating or inserting.
    const pathResults: Array<{ id: string; kind: string; uri: string }> = [];
    for (const pathSpec of p.paths) {
      const existing = await db.findOne<PrinterPathRow>('printerPath', {
        printerId: printer.id,
        agentId: agent.id,
        kind: pathSpec.kind,
      });
      if (existing) {
        await db.update('printerPath', { id: existing.id }, {
          uri: pathSpec.uri,
          lastSeenAt: now,
          status: pathSpec.status,
          capabilities: JSON.stringify(pathSpec.capabilities),
          updatedAt: now,
        });
        pathResults.push({ id: existing.id, kind: pathSpec.kind, uri: pathSpec.uri });
      } else {
        const created = await db.insert<PrinterPathRow>('printerPath', {
          id: crypto.randomUUID(),
          printerId: printer.id,
          agentId: agent.id,
          kind: pathSpec.kind,
          uri: pathSpec.uri,
          lastSeenAt: now,
          status: pathSpec.status,
          capabilities: JSON.stringify(pathSpec.capabilities),
          createdAt: now,
          updatedAt: now,
        } as never);
        pathResults.push({ id: created.id, kind: pathSpec.kind, uri: pathSpec.uri });
      }
    }

    // Aggregate the printer's status: online if ANY path is online.
    const anyOnline = p.paths.some((path) => path.status === 'online');
    const newStatus = anyOnline ? 'ONLINE' : 'OFFLINE';
    await db.update('printer', { id: printer.id }, { status: newStatus });

    // Realtime: publish a printer.status event.
    await publishQueueEvent(shopId, QUEUE_EVENTS.printerStatus, {
      printerId: printer.id,
      status: newStatus,
      paths: pathResults.length,
    });

    synced.push({
      printerId: printer.id,
      systemName: p.systemName,
      paths: pathResults,
    });
  }

  // Audit (best-effort).
  try {
    await db.insert('auditLog', {
      id: crypto.randomUUID(),
      shopId,
      userId: null,
      action: 'printer.sync',
      entityType: 'Printer',
      entityId: agent.id,
      metadata: JSON.stringify({
        agentId: agent.id,
        count: synced.length,
        printerIds: synced.map((s) => s.printerId),
      }),
      ip: req.headers.get('x-forwarded-for') || null,
      createdAt: now,
    });
  } catch {
    // best-effort
  }

  // Presence ping — the dashboard sees the agent just synced.
  void getContainer().realtime
    .publish(shopChannel(shopId), 'agent.heartbeat', { agentId: agent.id })
    .catch(() => {});

  return ok({ agentId: agent.id, synced });
});

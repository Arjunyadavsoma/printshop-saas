import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { publishQueueEvent, QUEUE_EVENTS } from '@/lib/queue/queue-events';

/**
 * PATCH /api/v1/shop/printers/:id — shopkeeper-authed (owner, staff).
 *
 * Operators CANNOT use this route — enable/disable and default flags are
 * operational policy levers the owner/staff retain. (Operators can still
 * reroute tasks to a printer via the queue routes; they just can't change
 * the printer's configuration.)
 *
 * Body (any subset):
 *   {
 *     displayName?: string,
 *     isDefaultColor?: boolean,
 *     isDefaultBw?: boolean,
 *     enabled?: boolean,
 *     speedPpm?: number
 *   }
 *
 * Returns the updated printer row.
 */
const PatchSchema = z.object({
  displayName: z.string().max(200).optional(),
  isDefaultColor: z.boolean().optional(),
  isDefaultBw: z.boolean().optional(),
  enabled: z.boolean().optional(),
  speedPpm: z.number().int().min(1).max(500).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

interface PrinterRow {
  id: string;
  shopId: string;
  agentId: string | null;
  systemName: string;
  displayName: string;
  supportsColor: boolean;
  supportsDuplex: boolean;
  paperSizes: string[];
  isDefaultColor: boolean;
  isDefaultBw: boolean;
  status: string;
  statusDetail: string | null;
  speedPpm: number;
  pagesPrintedToday: number;
  counterDate: Date | null;
  lastSeenAt: Date | null;
  enabled: boolean;
  printerUuid: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const PATCH = withAuth<{ id: string }>(async (req, ctx, principal) => {
  if (!principal.shopId) throw new ValidationError('No shop scope on this token.');
  const { id } = await ctx.params;
  const body = PatchSchema.parse(await req.json());

  const db = getContainer().db;
  const printer = await db.findOne<PrinterRow>('printer', { id, shopId: principal.shopId });
  if (!printer) throw new NotFoundError('Printer not found in your shop.');

  // Enforce single-default per shop: only one color default + one bw default.
  // When the patch sets isDefaultColor=true, clear the flag on every other
  // printer in the shop; same for isDefaultBw.
  if (body.isDefaultColor === true) {
    const others = await db.findMany<PrinterRow>('printer', { shopId: principal.shopId }, { limit: 200 });
    for (const o of others) {
      if (o.id !== id && o.isDefaultColor) {
        await db.update('printer', { id: o.id }, { isDefaultColor: false, updatedAt: new Date() });
      }
    }
  }
  if (body.isDefaultBw === true) {
    const others = await db.findMany<PrinterRow>('printer', { shopId: principal.shopId }, { limit: 200 });
    for (const o of others) {
      if (o.id !== id && o.isDefaultBw) {
        await db.update('printer', { id: o.id }, { isDefaultBw: false, updatedAt: new Date() });
      }
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.displayName !== undefined) patch.displayName = body.displayName;
  if (body.isDefaultColor !== undefined) patch.isDefaultColor = body.isDefaultColor;
  if (body.isDefaultBw !== undefined) patch.isDefaultBw = body.isDefaultBw;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.speedPpm !== undefined) patch.speedPpm = body.speedPpm;

  await db.update('printer', { id, shopId: principal.shopId }, patch);

  // Audit (best-effort).
  try {
    await db.insert('auditLog', {
      id: crypto.randomUUID(),
      shopId: principal.shopId,
      userId: principal.userId,
      action: 'printer.update',
      entityType: 'Printer',
      entityId: id,
      metadata: JSON.stringify({ before: { displayName: printer.displayName, enabled: printer.enabled, isDefaultColor: printer.isDefaultColor, isDefaultBw: printer.isDefaultBw }, after: patch }),
      ip: req.headers.get('x-forwarded-for') || null,
      createdAt: new Date(),
    });
  } catch {
    // best-effort
  }

  await publishQueueEvent(principal.shopId, QUEUE_EVENTS.printerStatus, {
    printerId: id,
    action: 'update',
    patch,
  });

  const updated = await db.findOne<PrinterRow>('printer', { id, shopId: principal.shopId });
  return ok(updated);
}, ['owner', 'staff']);

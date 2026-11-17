import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { shopChannel } from '@platform/core/interfaces';

/**
 * POST /api/v1/shops/me/devices/:deviceId/commands — owner/staff.
 *
 * Sends a remote command to a PrintEXE companion device. The command is
 * persisted with status='requested' + a 5-minute TTL; the companion picks it
 * up on its next GET /api/v1/companion/commands poll and reports the result
 * via POST /api/v1/companion/commands.
 *
 * Body: { commandType, payload?, idempotencyKey? }
 *
 *   - commandType MUST be in the allowlist below.
 *   - payload is an arbitrary JSON object (validated per command type by the
 *     companion); persisted as a JSON string.
 *   - idempotencyKey: if provided and a command with that key already exists,
 *     the existing command is returned unchanged (idempotent retry). If
 *     omitted, a fresh UUID is minted.
 */

const ALLOWED_COMMAND_TYPES = [
  'refresh_printers',
  'pause',
  'resume',
  'cancel_job',
  'retry_job',
  'test_print',
  'diagnostics',
] as const;

const SendCommandSchema = z.object({
  commandType: z.enum(ALLOWED_COMMAND_TYPES),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    // Phase 2 §11 hardening: bound the serialized payload (commands are small
    // control messages; the device stores them verbatim in its local queue).
    .refine((v) => v === undefined || Buffer.byteLength(JSON.stringify(v)) <= 16384, {
      message: 'Command payload must serialize to at most 16 KB.',
    }),
  idempotencyKey: z.string().min(1).max(120).optional(),
});

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

export const POST = withAuth(async (req, ctx, principal) => {
  if (!principal.shopId) throw new NotFoundError('Device not found in your shop.');
  const { deviceId } = await ctx.params;
  const shopId = principal.shopId;

  const body = SendCommandSchema.parse(await req.json().catch(() => ({} as unknown)));

  // Resolve the device (tenant-scoped) — 404 if it doesn't belong to this shop.
  const agent = await getContainer().db.findOne<{ id: string; name: string; isEnabled: boolean }>(
    'printAgent',
    { id: deviceId, shopId },
  );
  if (!agent) throw new NotFoundError('Device not found in your shop.');

  // A disabled device will not poll, so refuse to enqueue new commands —
  // otherwise the shopkeeper sees a command stuck in 'requested' forever.
  if (!agent.isEnabled) {
    throw new ValidationError(
      'Device is disabled. Enable it first to send commands.',
      { deviceId },
    );
  }

  const db = getContainer().db;
  const idempotencyKey = body.idempotencyKey ?? crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5-minute TTL
  const payloadJson = JSON.stringify(body.payload ?? {});

  // Idempotency: if a command with this key already exists, return it as-is.
  // This makes a shopkeeper "Send test print" double-click safe. The
  // idempotencyKey column is UNIQUE so a concurrent insert would collide —
  // the second call lands here on re-read instead.
  const existing = await db.findOne<DeviceCommandRow>('deviceCommand', { idempotencyKey });
  if (existing) {
    return ok({
      commandId: existing.id,
      commandType: existing.commandType,
      status: existing.status,
      payload: safeParse(existing.payload),
      idempotencyKey: existing.idempotencyKey,
      expiresAt: existing.expiresAt.toISOString(),
      createdAt: existing.createdAt.toISOString(),
      idempotentReplay: true,
    });
  }

  const row = await db.insert<DeviceCommandRow>(
    'deviceCommand',
    {
      id: crypto.randomUUID(),
      shopId,
      agentId: agent.id,
      commandType: body.commandType,
      payload: payloadJson,
      status: 'requested',
      initiatedBy: principal.userId,
      result: null,
      idempotencyKey,
      expiresAt,
      deliveredAt: null,
      executedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  );

  // Realtime nudge — the companion may be connected via a long-poll; a push
  // lets it wake immediately instead of waiting for the next poll tick.
  void getContainer().realtime
    .publish(shopChannel(shopId), 'device.command.issued', {
      agentId: agent.id,
      commandId: row.id,
      commandType: row.commandType,
    })
    .catch(() => {
      /* best-effort */
    });

  // Best-effort audit trail.
  void db
    .insert('auditLog', {
      id: crypto.randomUUID(),
      shopId,
      userId: principal.userId,
      action: 'device.command.sent',
      entityType: 'DeviceCommand',
      entityId: row.id,
      metadata: JSON.stringify({
        agentId: agent.id,
        commandType: row.commandType,
        idempotencyKey,
      }),
      ip: req.headers.get('x-forwarded-for') || null,
      createdAt: now,
    })
    .catch(() => {
      /* best-effort */
    });

  return ok({
    commandId: row.id,
    commandType: row.commandType,
    status: row.status,
    payload: safeParse(row.payload),
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    idempotentReplay: false,
  });
}, ['owner', 'staff']);

/** Parse a JSON payload column defensively; `{}` on null/garbage. */
function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

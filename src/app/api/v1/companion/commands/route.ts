import { z } from 'zod';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { NotFoundError } from '@platform/core/errors';

/**
 * Device command queue — the PrintEXE companion polls for commands issued by
 * the shopkeeper from the website (refresh_printers, pause, test_print, …)
 * and reports back the result of each.
 *
 *   GET  /api/v1/companion/commands        — pull pending commands
 *   POST /api/v1/companion/commands        — report a command's result
 *
 * Both are device-token-authed (`withDeviceAuth`). The agent identity is the
 * tenant scope — a companion can only ever see / mutate commands addressed to
 * its own PrintAgent row.
 */

/** A device command row, as persisted in the deviceCommand table. */
interface DeviceCommandRow {
  id: string;
  shopId: string;
  agentId: string;
  commandType: string;
  payload: string; // JSON string
  status: string; // requested|delivered|accepted|executing|succeeded|failed|expired|cancelled
  initiatedBy: string;
  result: string | null; // JSON string
  idempotencyKey: string;
  expiresAt: Date;
  deliveredAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape returned to the companion for each pending command. */
interface PendingCommandDto {
  commandId: string;
  commandType: string;
  payload: Record<string, unknown>;
  issuedAt: string;
  expiresAt: string;
}

/** Terminal + intermediate statuses the companion may report. */
const REPORTABLE_STATUSES = [
  'delivered',
  'accepted',
  'executing',
  'succeeded',
  'failed',
] as const;

const ReportSchema = z.object({
  commandId: z.string().min(1),
  status: z.enum(REPORTABLE_STATUSES),
  result: z.record(z.string(), z.unknown()).optional(),
});

/**
 * GET /api/v1/companion/commands — device-token-authed.
 *
 * Returns all commands for this device whose status is 'requested' and that
 * have not yet expired. Commands past their expiresAt are flipped to
 * 'expired' (best-effort) and excluded so the companion never acts on a
 * stale command.
 */
export const GET = withDeviceAuth(async (_req, _ctx, { agent }) => {
  const db = getContainer().db;
  const rows = await db.findMany<DeviceCommandRow>(
    'deviceCommand',
    { agentId: agent.id, status: 'requested' },
    { order: ['createdAt', 'asc'], limit: 50 },
  );

  const now = Date.now();
  const pending: PendingCommandDto[] = [];
  for (const row of rows) {
    if (row.expiresAt.getTime() < now) {
      // Best-effort expire — don't let stale commands linger in 'requested'.
      void db
        .update('deviceCommand', { id: row.id, status: 'requested' }, { status: 'expired' })
        .catch(() => {});
      continue;
    }
    pending.push({
      commandId: row.id,
      commandType: row.commandType,
      payload: safeParse(row.payload),
      issuedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }

  // Mark the batch as delivered (best-effort) so the dashboard sees that the
  // companion received them. We only flip rows still in 'requested' to avoid
  // clobbering a concurrent status report from the companion itself.
  for (const p of pending) {
    void db
      .update(
        'deviceCommand',
        { id: p.commandId, status: 'requested' },
        { status: 'delivered', deliveredAt: new Date() },
      )
      .catch(() => {});
  }

  return ok({ agentId: agent.id, commands: pending });
});

/**
 * POST /api/v1/companion/commands — device-token-authed.
 *
 * Body: { commandId, status, result? }
 *
 * The companion reports the outcome (or an intermediate progress state) of a
 * command it pulled via GET. The command must belong to this device; a
 * cross-device commandId is rejected with 404 (not 403) to avoid leaking the
 * existence of commands addressed to other devices.
 */
export const POST = withDeviceAuth(async (req, _ctx, { agent }) => {
  const body = ReportSchema.parse(await req.json().catch(() => ({} as unknown)));
  const db = getContainer().db;

  const row = await db.findOne<DeviceCommandRow>('deviceCommand', {
    id: body.commandId,
    agentId: agent.id,
  });
  if (!row) {
    throw new NotFoundError('Command not found for this device.');
  }

  // The reported status is already validated by zod against the reportable
  // set (delivered|accepted|executing|succeeded|failed) — 'requested' is the
  // pre-delivery state and is rejected at the schema layer, so no extra guard
  // is needed here.
  const isTerminal = body.status === 'succeeded' || body.status === 'failed';
  const patch: Partial<DeviceCommandRow> = {
    status: body.status,
    result: body.result ? JSON.stringify(body.result) : row.result,
    updatedAt: new Date(),
  };
  if (isTerminal && !row.executedAt) {
    patch.executedAt = new Date();
  }

  await db.update('deviceCommand', { id: row.id }, patch);

  return ok({ commandId: row.id, status: body.status, updatedAt: patch.updatedAt!.toISOString() });
});

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

import { z } from 'zod';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { ok } from '@/lib/api/envelope';
import { db } from '@/lib/db';
import { getContainer } from '@/lib/container';
import { shopChannel } from '@platform/core/interfaces';
import { markPushAt, getOrCreateSyncState } from '@/lib/repositories/sync.repository';

const PushChangeSchema = z.object({
  entity: z.string(),
  id: z.string().uuid(),
  action: z.enum(['upsert', 'delete']),
  data: z.record(z.string(), z.unknown()),
  clientRevision: z.number().int(),
  baseRevision: z.number().int(),
});

const PushSchema = z.object({
  changes: z.array(PushChangeSchema).max(100),
});

// ── Customer field validation ──
// The desktop sends a Customer record's editable fields in `change.data`.
// We strip server-managed fields (id, shopId, createdAt, revision, deletedAt)
// and validate the remainder against these schemas so the Prisma insert/update
// gets a known-good shape. (Without this, the untyped `change.data` would
// require `as any` casts at the Prisma boundary — and a stray field like
// `shopId: "<other shop>"` could slip through before our tenant-override.)
const CustomerFieldsSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(20).nullish(),
  email: z.string().email().max(200).nullish(),
  address: z.string().max(500).nullish(),
  notes: z.string().max(2000).nullish(),
});

const CustomerCreateSchema = CustomerFieldsSchema;
const CustomerUpdateSchema = CustomerFieldsSchema.partial();

/** Strip server-managed fields from a client-supplied data object. */
function stripServerManagedFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const {
    id: _id,
    shopId: _shopId,
    createdAt: _createdAt,
    revision: _revision,
    deletedAt: _deletedAt,
    updatedAt: _updatedAt,
    ...rest
  } = data;
  return rest;
}

interface PushResultEntry {
  id: string;
  accepted: boolean;
  conflict: boolean;
  serverRevision?: number;
  serverData?: unknown;
  reason?: string;
  error?: string;
}

/**
 * POST /api/v1/sync/push — device-token-authed.
 *
 * Submits a batch of client-side changes. Each change is applied with
 * last-write-wins conflict detection:
 *   - If `baseRevision` (client's prior knowledge) < server's current
 *     `revision`, the server rejects with `conflict: true` and returns
 *     the current server data so the client can merge + retry.
 *   - Otherwise the change is applied, `revision` is incremented, and the
 *     new `serverRevision` is returned.
 *
 * Tenant boundary: the shopId comes from the device token. Every push is
 * scoped to `agentPrincipal.shopId` — a device cannot push records for
 * another shop, and the `shopId` field on `data` is forcibly overwritten
 * with the authenticated shopId before any write.
 *
 * Pushable entities (Phase 5 v1):
 *   - Customer — bidirectional. Desktop can create walk-in customers offline.
 *
 * Non-pushable (server-authoritative):
 *   - Order, PrintFile, PrintJob, Shop, PrintAgent — these have dedicated
 *     mutation endpoints (/orders, /shops/me/orders/*, etc.) that enforce
 *     business rules (payment verification, job dispatch, token allocation).
 *     The desktop MUST use those endpoints to mutate them — push returns
 *     `accepted: false` with a `reason` pointing to the right endpoint.
 */
export const POST = withDeviceAuth(async (req, _ctx, agentPrincipal) => {
  const body = PushSchema.parse(await req.json());
  const results: PushResultEntry[] = [];

  for (const change of body.changes) {
    if (change.entity === 'Customer') {
      try {
        // Use the typed Prisma client. The Customer model is part of the
        // generated PrismaClient after `db:generate`. (A `(db as any)`
        // cast would also work and was used in the original spec — kept
        // typed here for safety, with the try/catch as the runtime guard
        // for the table-not-migrated case.)
        const existing = await db.customer.findUnique({
          where: { id: change.id },
        });

        // Tenant boundary — refuse to mutate a Customer that belongs to a
        // different shop. Without this check, a malicious device could push
        // `{id: <victim's customer id>}` and overwrite another shop's row.
        if (existing && existing.shopId !== agentPrincipal.shopId) {
          results.push({
            id: change.id,
            accepted: false,
            conflict: true,
            reason: 'not found or wrong tenant',
          });
          continue;
        }

        if (change.action === 'delete') {
          if (existing) {
            // Soft delete — set `deletedAt` and bump `revision` so the pull
            // stream surfaces the delete to other devices. Hard deletes
            // would break the sync protocol (no event to fan out).
            const updated = await db.customer.update({
              where: { id: change.id },
              data: {
                deletedAt: new Date(),
                revision: { increment: 1 },
              },
            });
            results.push({
              id: change.id,
              accepted: true,
              conflict: false,
              serverRevision: updated.revision,
            });
          } else {
            // Idempotent delete — the row is already gone (or was never
            // there). Return accepted:true so the client doesn't retry.
            results.push({
              id: change.id,
              accepted: true,
              conflict: false,
              serverRevision: change.baseRevision,
              reason: 'already deleted',
            });
          }
        } else {
          // upsert
          if (existing) {
            // Conflict check — last-write-wins. If the server's revision is
            // ahead of the client's baseRevision, reject and return the
            // server's current data so the client can merge.
            if (existing.revision > change.baseRevision) {
              results.push({
                id: change.id,
                accepted: false,
                conflict: true,
                serverRevision: existing.revision,
                serverData: existing,
              });
              continue;
            }
            // Strip immutable/identity fields from the patch — `id`,
            // `shopId`, `createdAt` cannot be changed by the client.
            const patchRaw = stripServerManagedFields(
              change.data as Record<string, unknown>,
            );
            // Validate the patch — narrow to known Customer fields.
            const patchParse = CustomerUpdateSchema.safeParse(patchRaw);
            if (!patchParse.success) {
              results.push({
                id: change.id,
                accepted: false,
                conflict: false,
                error: `Invalid Customer fields: ${patchParse.error.message}`,
              });
              continue;
            }

            const updated = await db.customer.update({
              where: { id: change.id },
              data: {
                ...patchParse.data,
                // Enforce tenant — never trust a shopId from the client.
                shopId: agentPrincipal.shopId,
                // Clear `deletedAt` if the client is re-creating a row that
                // was previously soft-deleted (e.g. a customer was deleted
                // then re-added offline).
                deletedAt: null,
                revision: { increment: 1 },
              },
            });
            results.push({
              id: change.id,
              accepted: true,
              conflict: false,
              serverRevision: updated.revision,
            });
          } else {
            // Create — the client supplied the id (offline UUID). Strip
            // server-managed fields before insert.
            const createRaw = stripServerManagedFields(
              change.data as Record<string, unknown>,
            );
            const createParse = CustomerCreateSchema.safeParse(createRaw);
            if (!createParse.success) {
              results.push({
                id: change.id,
                accepted: false,
                conflict: false,
                error: `Invalid Customer create: ${createParse.error.message}`,
              });
              continue;
            }

            const created = await db.customer.create({
              data: {
                ...createParse.data,
                id: change.id,
                shopId: agentPrincipal.shopId,
                revision: 1,
              },
            });
            results.push({
              id: change.id,
              accepted: true,
              conflict: false,
              serverRevision: created.revision,
            });
          }
        }
      } catch (e) {
        // Per-change error — don't fail the whole batch. Other changes
        // may still apply. The client retries failed changes individually.
        results.push({
          id: change.id,
          accepted: false,
          conflict: false,
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    } else {
      // Non-pushable entities (Order, PrintJob, etc.) — server-authoritative.
      // The desktop MUST use the dedicated mutation endpoints (e.g.
      // POST /api/v1/shops/me/orders/[id]/start for status transitions).
      results.push({
        id: change.id,
        accepted: false,
        conflict: false,
        reason: `${change.entity} is server-authoritative; use the dedicated API endpoints`,
      });
    }
  }

  // Mark the device's lastPushAt so /sync/status reflects activity.
  const state = await getOrCreateSyncState(
    agentPrincipal.shopId,
    agentPrincipal.agent.id,
  );
  await markPushAt(state.id);

  // Best-effort realtime fan-out — notify connected desktops/dashboards
  // that a sync batch landed so they can trigger an immediate pull instead
  // of waiting for the next poll.
  try {
    const acceptedCount = results.filter((r) => r.accepted).length;
    if (acceptedCount > 0) {
      void getContainer()
        .realtime.publish(
          shopChannel(agentPrincipal.shopId),
          'sync.pushed',
          { count: acceptedCount, deviceId: agentPrincipal.agent.id },
        )
        .catch(() => {
          /* best-effort — realtime is non-blocking */
        });
    }
  } catch {
    /* best-effort — never fail a push because of realtime */
  }

  return ok({ results });
});

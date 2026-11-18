import { z } from 'zod';
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { shopChannel } from '@platform/core/interfaces';
import { repos } from '@/lib/repositories';
import { hashDeviceToken } from '@/lib/api/device-token';
import { AppError } from '@platform/core/errors';

const BODY_SCHEMA = z.object({
  // Reserved for future confirmation payloads; the endpoint is intentionally
  // zero-config for the device: authenticate with the CURRENT token, receive
  // the NEW token once. Empty body is valid.
  reason: z.string().max(120).optional(),
});

/**
 * POST /api/v1/companion/token/rotate — device-token-authed.
 *
 * Rolls the device credential: mints a fresh 256-bit token, stores only its
 * versioned HMAC verifier (v2 — DEVICE_TOKEN_PEPPER), and keeps the previous
 * hash in `prevTokenHash` for a short (10-minute) overlap so a device that is
 * mid-persist is not locked out. The raw token is returned ONCE and never
 * stored server-side. Rotation also migrates a legacy-format verifier to v2,
 * which is the ONLY path off the legacy pepper (see '@/lib/api/device-token').
 *
 * Policy (integration spec §8.3, Phase C review):
 * - Requires an already-authenticated device — no unauthenticated rotation.
 * - CONCURRENCY: the hash update is a conditional update WHERE tokenHash =
 *   the hash the caller authenticated with (optimistic lock). Two concurrent
 *   rotations cannot both succeed: the loser gets 0 updated rows and a 409
 *   ROTATION_CONFLICT — its newly minted token was never stored, so no
 *   credential is orphaned.
 * - REPLAY: only the CURRENT (or in-overlap previous) credential can rotate;
 *   each successful rotation replaces tokenHash, so a replayed request
 *   cannot mint further valid credentials without holding a live credential.
 * - The old credential keeps ONLY the restricted overlap powers defined in
 *   with-auth.ts PREVIOUS_CREDENTIAL_ALLOWED (heartbeat, read-only polling,
 *   rotation recovery) until the 10-minute window closes.
 * - Lost response: the device retries with the still-valid old credential
 *   (or the newly persisted one) — see RotateDeviceTokenAsync on the client.
 *   If the window closes before a retry succeeds, re-pairing is the
 *   documented recovery; no server-side lockout is added.
 * - Does NOT reset commands/jobs state; agent identity, history, queue and
 *   audit trail survive.
 *
 * Audit-logged. Realtime `device.token_rotated` is published so a connected
 * dashboard can show the event.
 */
export const POST = withDeviceAuth(
  async (req, _ctx, { agent, shopId }) => {
    try {
      let body: z.infer<typeof BODY_SCHEMA> = {};
      try {
        const raw = await req.json();
        body = BODY_SCHEMA.parse(raw);
      } catch {
        // Empty/absent body is fine — reason is optional metadata only.
      }

      const now = new Date();
      const container = getContainer();

      const newToken = randomBytes(32).toString('hex');
      const newHash = hashDeviceToken(newToken);

      // Optimistic lock: only rotate if the stored hash is still the one we
      // authenticated against. If a concurrent rotation already replaced it,
      // this update affects 0 rows and we return a retryable conflict WITHOUT
      // storing anything.
      const rotated = await container.db.update(
        'printAgent',
        { id: agent.id, tokenHash: agent.tokenHash },
        {
          tokenHash: newHash,
          prevTokenHash: agent.tokenHash,
          tokenRotatedAt: now,
        },
      );
      if (rotated.length === 0) {
        throw new AppError(
          'Token was just rotated by another request. Retry with your current credential.',
          'ROTATION_CONFLICT',
          409,
        );
      }

      // Audit — never log any token material.
      try {
        await container.db.insert('auditLog', {
          id: crypto.randomUUID(),
          shopId,
          userId: null,
          action: 'device.token_rotated',
          entityType: 'PrintAgent',
          entityId: agent.id,
          metadata: JSON.stringify({
            deviceName: agent.name,
            reason: body.reason ?? null,
            rotatedAt: now.toISOString(),
          }),
          ip: req.headers.get('x-forwarded-for') || null,
          createdAt: now,
        });
      } catch { /* audit is non-fatal */ }

      void container.realtime
        .publish(shopChannel(shopId), 'device.token_rotated', {
          agentId: agent.id,
          deviceName: agent.name,
          rotatedAt: now.toISOString(),
        })
        .catch(() => { /* best-effort */ });

      // Overlap window mirrors with-auth.ts DEVICE_TOKEN_OVERLAP_MS.
      const overlapExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

      return ok({
        agentId: agent.id,
        deviceToken: newToken, // returned ONCE — only the HMAC verifier is stored
        rotatedAt: now.toISOString(),
        overlapExpiresAt: overlapExpiresAt.toISOString(),
        warning: 'Store this token now (DPAPI on Windows). The previous token is accepted for 10 more minutes only, and only for heartbeat, read-only polling, and rotation recovery.',
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
  // Rotation is rare and device-driven; cap abuse without blocking retries.
  { rateLimit: { limit: 5, windowSeconds: 60 } },
);

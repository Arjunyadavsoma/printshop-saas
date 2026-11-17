import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHmac, randomBytes } from 'node:crypto';
import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { shopChannel } from '@platform/core/interfaces';
import { repos } from '@/lib/repositories';

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
 * HMAC verifier, and keeps the previous hash in `prevTokenHash` for a short
 * (10-minute) overlap so a device that is mid-persist is not locked out.
 * The raw token is returned ONCE and never stored server-side.
 *
 * Policy (see the integration spec §8.3):
 * - Requires an already-authenticated device — no unauthenticated rotation.
 * - Rotation does NOT reset commands/jobs state; the agent row identity is
 *   unchanged, so history, queue, and audit trail survive.
 * - The old credential stops working once the grace window closes.
 * - Idempotent-and-recoverable: if the device fails to persist the new token
 *   it simply keeps authenticating with the old one inside the window and
 *   can call this endpoint again.
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
      const newHash = createHmac('sha256', 'print-agent-salt').update(newToken).digest('hex');

      await repos.printAgents.update(agent.id, {
        tokenHash: newHash,
        prevTokenHash: agent.tokenHash,
        tokenRotatedAt: now,
      });

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
        warning: 'Store this token now (DPAPI on Windows). The previous token is accepted for 10 more minutes only.',
      });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
  // Rotation is rare and device-driven; cap abuse without blocking retries.
  { rateLimit: { limit: 5, windowSeconds: 60 } },
);

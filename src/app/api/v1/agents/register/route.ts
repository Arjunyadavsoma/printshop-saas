import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { isEntitled } from '@/lib/api/entitlements';
import { hashDeviceToken } from '@/lib/api/device-token';
import { ForbiddenError } from '@platform/core/errors';

const RegisterSchema = z.object({
  name: z.string().min(1).max(120),
  os: z.string().max(40).optional(),
  version: z.string().max(40).optional(),
  printerName: z.string().max(200).optional(),
});

/**
 * POST /api/v1/agents/register — shop-owner-authed. Mints a device token for
 * a new print-agent daemon. The plaintext token is returned ONCE (only the
 * SHA-256 hash is stored), so the shopkeeper copy-pastes it into the agent's
 * setup wizard.
 */
export const POST = withAuth(async (req, ctx, principal) => {
  const body = RegisterSchema.parse(await req.json());
  const shop = await repos.shops.getByOwner(principal.userId);

  // multi_device entitlement — same policy as /companion/pairing/begin:
  // the first device is always allowed, additional devices need the feature.
  const shopDevices = await repos.printAgents.listByShop(shop.id);
  const enabledDeviceCount = shopDevices.filter((d) => d.isEnabled !== false).length;
  if (enabledDeviceCount >= 1 && !(await isEntitled(shop.id, 'multi_device'))) {
    throw new ForbiddenError(
      'ENTITLEMENT_REQUIRED: multi_device — your current plan supports one paired Windows device. Upgrade the subscription to connect more.',
    );
  }

  // 256-bit CSPRNG token (Phase 2 §5: >= 256 bits of cryptographically
  // secure randomness). The old uuid-uuid format (~244 bits) remains valid
  // for existing tokens because verification is hash-based, not format-based.
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashDeviceToken(token);
  const agent = await repos.printAgents.create({ shopId: shop.id, name: body.name, tokenHash });
  await repos.printAgents.update(agent.id, {
    os: body.os ?? null,
    version: body.version ?? null,
    printerName: body.printerName ?? null,
  });
  return ok({
    agentId: agent.id,
    deviceToken: token, // returned ONCE — the hash is stored, not the plaintext
    shopId: shop.id,
    shopName: shop.name,
    warning: 'Save this token — it is shown only once.',
  });
});

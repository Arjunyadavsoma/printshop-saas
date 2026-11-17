import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { isEntitled } from '@/lib/api/entitlements';
import { hashDeviceToken } from '@/lib/api/device-token';
import { AppError } from '@platform/core/errors';

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
    // Phase 5: machine-readable ENTITLEMENT_REQUIRED code (parity with
    // /companion/pair) — clients key on error.code, not the message text.
    throw new AppError(
      'ENTITLEMENT_REQUIRED: multi_device — your current plan supports one paired Windows device. Upgrade the subscription to connect more.',
      'ENTITLEMENT_REQUIRED',
      403,
    );
  }

  // 256-bit CSPRNG token (Phase 2 §5: >= 256 bits of cryptographically
  // secure randomness). The old uuid-uuid format (~244 bits) remains valid
  // for existing tokens because verification is hash-based, not format-based.
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashDeviceToken(token);
  const agent = await repos.printAgents.create({ shopId: shop.id, name: body.name, tokenHash });

  // Phase 5 fix: post-insert reconciliation, mirroring /companion/pair.
  // The pre-check above is TOCTOU-racy: two concurrent registrations by the
  // same owner on a single-device plan can both read enabledDeviceCount = 0
  // and both pass. After inserting, re-count; if the entitlement is now
  // exceeded, disable the device THIS request created (the other one, already
  // enabled first, keeps working) and reject — no over-limit device exists.
  const afterInsert = await repos.printAgents.listByShop(shop.id);
  const enabledAfter = afterInsert.filter((d) => d.isEnabled !== false).length;
  if (enabledAfter > 1 && !(await isEntitled(shop.id, 'multi_device'))) {
    await repos.printAgents.update(agent.id, { isEnabled: false, isOnline: false });
    await repos.audit.log({
      shopId: shop.id,
      userId: principal.userId,
      action: 'device.limit_disabled',
      entityType: 'PrintAgent',
      entityId: agent.id,
      metadata: { deviceName: body.name, reason: 'multi_device entitlement exceeded by concurrent registration' },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });
    throw new AppError(
      'ENTITLEMENT_REQUIRED: multi_device — a second device was disabled because your plan supports one paired Windows device. Upgrade the subscription to connect more.',
      'ENTITLEMENT_REQUIRED',
      403,
    );
  }
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

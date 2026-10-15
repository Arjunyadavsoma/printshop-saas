import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

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
  const token = crypto.randomUUID() + '-' + crypto.randomUUID();
  const tokenHash = createHmac('sha256', 'print-agent-salt').update(token).digest('hex');
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

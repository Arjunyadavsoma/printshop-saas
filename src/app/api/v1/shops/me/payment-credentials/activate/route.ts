import { z } from 'zod';
import { withAuth, withRateLimit } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { ValidationError } from '@platform/core/errors';

/**
 * POST /api/v1/shops/me/payment-credentials/activate
 *
 * Activate a payment provider for the shop. This sets `shop.paymentProvider`
 * to the specified provider so the checkout flow uses it for new payments.
 *
 * Requirements:
 *   - The shop must have saved credentials for the provider (checked).
 *   - The provider must be registered in the payment adapter registry.
 *   - Existing pending payment attempts are preserved (they keep their
 *     original provider reference — switching providers doesn't affect
 *     in-flight transactions).
 *
 * Body: { provider: 'phonepe' | 'paytm' }
 * Response: { ok: true, activeProvider: 'phonepe' | 'paytm' }
 */

const ActivateSchema = z.object({
  provider: z.enum(['phonepe', 'paytm']),
});

export const POST = withRateLimit('pay-creds-activate', 10, 60, withAuth(async (req, _ctx, principal) => {
  const body = ActivateSchema.parse(await req.json());
  const shop = await repos.shops.getByOwner(principal.userId);

  // Verify the shop has credentials for the requested provider.
  const creds = shop.paymentCredentials as Record<string, unknown>;
  const providerCreds = creds[body.provider];
  if (!providerCreds) {
    throw new ValidationError(
      `Cannot activate ${body.provider} — no credentials saved. Save credentials first.`,
    );
  }

  // Activate the provider.
  await repos.shops.update(shop.id, {
    paymentProvider: body.provider,
  } as never);

  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'payment.provider.activated',
    entityType: 'shop',
    entityId: shop.id,
    metadata: { provider: body.provider, previousProvider: shop.paymentProvider },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  return ok({ ok: true, activeProvider: body.provider });
}, ['owner']));

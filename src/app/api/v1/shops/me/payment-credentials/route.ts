import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { ValidationError, NotFoundError } from '@platform/core/errors';

/**
 * Payment credentials management API.
 *
 *   GET    /api/v1/shops/me/payment-credentials — status (masked, no secrets)
 *   PUT    /api/v1/shops/me/payment-credentials — save/update credentials
 *   DELETE /api/v1/shops/me/payment-credentials — disconnect (remove credentials)
 *
 * SECURITY:
 *   - Credentials are encrypted server-side via the existing AES-256-GCM
 *     infrastructure (credential-encryption.ts) before DB storage.
 *   - The GET response NEVER returns plaintext secrets — only masked
 *     identifiers (e.g. "••••••••••••") + metadata.
 *   - The PUT body is validated with Zod per-provider + per-auth-version.
 *   - Audit logs record the ACTION (saved/activated/disconnected) with
 *     redacted field names only — NEVER the credential values.
 *   - Every operation is scoped to the authenticated user's shop
 *     (principal.shopId) — cross-tenant access is impossible.
 */

// ─── Zod schemas ─────────────────────────────────────────────────

const PhonePeV2Schema = z.object({
  provider: z.literal('phonepe'),
  authVersion: z.literal('v2'),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
  clientVersion: z.string().or(z.number()).default('1'),
  merchantId: z.string().min(1).max(100),
  env: z.enum(['sandbox', 'prod']).default('sandbox'),
});

const PhonePeV1Schema = z.object({
  provider: z.literal('phonepe'),
  authVersion: z.literal('v1'),
  merchantId: z.string().min(1).max(100),
  saltKey: z.string().min(1).max(500),
  saltIndex: z.string().min(1).max(10),
  env: z.enum(['sandbox', 'prod']).default('sandbox'),
});

const PaytmSchema = z.object({
  provider: z.literal('paytm'),
  authVersion: z.literal('standard').default('standard'),
  merchantId: z.string().min(1).max(100),
  merchantKey: z.string().min(1).max(500),
  website: z.string().min(1).max(50),
  industryType: z.string().max(50).optional(),
  channelId: z.string().max(10).optional(),
  env: z.enum(['sandbox', 'prod']).default('sandbox'),
});

const SaveCredentialsSchema = z.discriminatedUnion('provider', [
  PhonePeV2Schema,
  PhonePeV1Schema,
  PaytmSchema,
]);

const ActivateSchema = z.object({
  provider: z.enum(['phonepe', 'paytm']),
});

// ─── Helpers ─────────────────────────────────────────────────────

/** Mask a secret string — show only the last 4 chars (e.g. "••••••••3M3"). */
function maskSecret(s: string | undefined): string | null {
  if (!s) return null;
  if (s.length <= 4) return '••••';
  return '••••••••' + s.slice(-4);
}

/** Mask a non-secret identifier — show first 4 + last 4 (e.g. "M23I...0433"). */
function maskId(s: string | undefined): string | null {
  if (!s) return null;
  if (s.length <= 8) return s;
  return s.slice(0, 4) + '...' + s.slice(-4);
}

/** Build a safe (no-secrets) status object from the shop's decrypted credentials. */
function buildStatus(shop: {
  paymentProvider: string;
  paymentCredentials: Record<string, unknown>;
}) {
  const creds = shop.paymentCredentials;
  const providers: Record<string, unknown> = {};

  // PhonePe — the credential shape is validated by the Zod schema on save;
  // here we just read it as a plain record for masking.
  const phonepe = creds.phonepe as Record<string, unknown> | undefined;
  if (phonepe) {
    const isV2 = !!(phonepe.clientId && phonepe.clientSecret);
    providers.phonepe = {
      connected: true,
      authVersion: isV2 ? 'v2' : 'v1',
      env: phonepe.env ?? 'sandbox',
      merchantId: maskId(phonepe.merchantId as string | undefined),
      clientId: isV2 ? maskId(phonepe.clientId as string | undefined) : null,
      saltKey: !isV2 ? maskSecret(phonepe.saltKey as string | undefined) : null,
      // NEVER return the actual secret values — only the masked version.
    };
  } else {
    providers.phonepe = { connected: false };
  }

  // Paytm
  const paytm = creds.paytm as Record<string, unknown> | undefined;
  if (paytm) {
    providers.paytm = {
      connected: true,
      authVersion: 'standard',
      env: paytm.env ?? 'sandbox',
      merchantId: maskId(paytm.merchantId as string | undefined),
      website: (paytm.website as string | undefined) ?? null,
      // NEVER return merchantKey.
    };
  } else {
    providers.paytm = { connected: false };
  }

  return {
    activeProvider: shop.paymentProvider,
    providers,
    // The webhook URLs are derived from the deployment origin (not secrets).
    webhookUrls: {
      phonepe: '/api/v1/payments/phonepe/webhook',
      paytm: '/api/v1/payments/paytm/callback',
    },
  };
}

// ─── GET: payment credentials status (masked) ────────────────────

export const GET = withAuth(async (_req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  // shop.paymentCredentials is already decrypted by toDomain() — but we
  // only return MASKED values (buildStatus strips all secrets).
  return ok(buildStatus(shop));
});

// ─── PUT: save/update credentials ────────────────────────────────

export const PUT = withAuth(async (req, _ctx, principal) => {
  const body = SaveCredentialsSchema.parse(await req.json());
  const shop = await repos.shops.getByOwner(principal.userId);

  // Load the existing encrypted credentials (decrypted by toDomain).
  const existingCreds = shop.paymentCredentials as Record<string, unknown>;

  // Build the new credential object for the selected provider.
  // The OTHER provider's credentials are preserved (not overwritten).
  let providerCreds: Record<string, unknown>;
  if (body.provider === 'phonepe') {
    if (body.authVersion === 'v2') {
      providerCreds = {
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        clientVersion: String(body.clientVersion),
        merchantId: body.merchantId,
        env: body.env,
      };
    } else {
      providerCreds = {
        saltKey: body.saltKey,
        saltIndex: body.saltIndex,
        merchantId: body.merchantId,
        env: body.env,
      };
    }
  } else {
    // paytm
    providerCreds = {
      merchantId: body.merchantId,
      merchantKey: body.merchantKey,
      website: body.website,
      industryType: body.industryType,
      channelId: body.channelId,
      env: body.env,
    };
  }

  // Merge: keep the other provider's credentials, replace this one's.
  const mergedCreds = { ...existingCreds, [body.provider]: providerCreds };

  // Save — repos.shops.update encrypts the credentials via toRow().
  // The paymentCredentials field is stored as an encrypted string in the DB.
  await repos.shops.update(shop.id, {
    paymentCredentials: mergedCreds as never,
  } as never);

  // Audit log — record the action with REDACTED field names only.
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'payment.credentials.saved',
    entityType: 'shop',
    entityId: shop.id,
    metadata: {
      provider: body.provider,
      authVersion: body.authVersion,
      env: body.env,
      // NEVER log the actual credential values.
      fields: Object.keys(providerCreds).filter((k) => !['clientSecret', 'saltKey', 'merchantKey'].includes(k)),
    },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  // Return the masked status (not the saved credentials).
  const updatedShop = await repos.shops.getByOwner(principal.userId);
  return ok(buildStatus(updatedShop));
});

// ─── DELETE: disconnect (remove credentials for a provider) ──────

export const DELETE = withAuth(async (req, _ctx, principal) => {
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider');
  if (!provider || !['phonepe', 'paytm'].includes(provider)) {
    throw new ValidationError('Missing or invalid ?provider= query param (must be "phonepe" or "paytm")');
  }

  const shop = await repos.shops.getByOwner(principal.userId);
  const existingCreds = shop.paymentCredentials as Record<string, unknown>;

  // Remove the provider's credentials but keep the other provider's.
  const { [provider]: _removed, ...remainingCreds } = existingCreds;

  // If the disconnected provider was the active one, switch to 'googlepay'
  // (the UPI deep-link fallback — the shopkeeper can still receive payments
  // via manual UPI QR + manual verification).
  const patch: Record<string, unknown> = {
    paymentCredentials: remainingCreds,
  };
  if (shop.paymentProvider === provider) {
    patch.paymentProvider = 'googlepay';
  }

  await repos.shops.update(shop.id, patch as never);

  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'payment.credentials.disconnected',
    entityType: 'shop',
    entityId: shop.id,
    metadata: { provider, wasActive: shop.paymentProvider === provider },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });

  const updatedShop = await repos.shops.getByOwner(principal.userId);
  return ok(buildStatus(updatedShop));
});

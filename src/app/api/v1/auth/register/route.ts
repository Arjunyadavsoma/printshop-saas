import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import {
  ValidationError,
  UnauthorizedError,
} from '@platform/core/errors';
import { createDefaultPricingConfig } from '@platform/core/domain';
import { UpiIdSchema, ShopSlugSchema, IndianPhoneSchema } from '@platform/utils';

/**
 * POST /api/v1/auth/register
 *
 * Combined shop + owner onboarding endpoint: creates a User (role='owner')
 * AND a Shop in one call. The shop is provisioned with default pricing, the
 * chosen UPI id, and an empty (in-memory) payment-credentials blob — the
 * owner can add real credentials later from the settings page.
 *
 * Idempotent on email: if a user already exists with this email, we reject
 * with a 409 (the client offers a "log in instead" link).
 */
const RegisterSchema = z.object({
  // Account
  email: z.string().email(),
  password: z.string().min(8).max(200),
  phone: IndianPhoneSchema,
  name: z.string().min(1).max(120),
  // Business
  shopName: z.string().min(1).max(120),
  slug: ShopSlugSchema,
  description: z.string().max(2000).optional().default(''),
  upiId: UpiIdSchema,
  address: z.string().max(300).default(''),
  // Services — list of strings (bw, color, scan, laminate, binding, photo, document)
  services: z.array(z.string().max(40)).max(20).default([]),
});

const ALLOWED_SERVICES = new Set([
  'bw_print', 'color_print', 'a3_print', 'scan', 'laminate',
  'binding', 'photo_print', 'document_print', 'id_card', 'passport_photo',
]);

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'register'), 5, 60);
    const body = RegisterSchema.parse(await req.json());

    // Validate service keys against the allowlist.
    const unknown = body.services.filter((s) => !ALLOWED_SERVICES.has(s));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown service: ${unknown.join(', ')}`);
    }

    // Email uniqueness — try login-style lookup; if found, 409.
    const existingUser = await repos.users.findByEmail(body.email);
    if (existingUser) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMAIL_TAKEN',
            message: 'An account with this email already exists. Try logging in instead.',
          },
        },
        { status: 409 },
      );
    }

    // Slug uniqueness.
    const existingShop = await repos.shops.findBySlug(body.slug);
    if (existingShop) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SLUG_TAKEN',
            message: `The shop URL "/${body.slug}" is already in use. Pick a different slug.`,
          },
        },
        { status: 409 },
      );
    }

    const container = getContainer();
    const owner = await repos.users.create(
      {
        email: body.email,
        phone: body.phone,
        password: body.password,
        role: 'owner',
        shopId: null, // set after the shop row is inserted
      },
      container.auth,
    );

    const pricingConfig = createDefaultPricingConfig();
    const servicesJson = JSON.stringify(body.services);
    const shop = await repos.shops.create({
      id: crypto.randomUUID(),
      name: body.shopName,
      slug: body.slug,
      ownerUserId: owner.id,
      upiId: body.upiId,
      // Dev-fallback credentials — empty JSON object string. The encryption
      // boundary in the repository treats {} as "no creds yet"; the
      // shopkeeper adds real ones via /shop/settings later.
      paymentProvider: 'googlepay',
      paymentCredentials: {},
      pricingConfig,
      address: body.address,
      phone: body.phone,
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: 'free',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      description: body.description || null,
      businessHours: null,
      logoUrl: null,
      upiQrStorageKey: null,
      servicesJson,
      paymentPhone: null,
      paymentInstructions: null,
      cashOnPickup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof repos.shops.create>[0]);

    // Back-link owner → shop.
    await repos.users.update(owner.id, { shopId: shop.id });

    await repos.audit.log({
      shopId: shop.id,
      userId: owner.id,
      action: 'shop.create',
      entityType: 'shop',
      entityId: shop.id,
      metadata: { source: 'self_register', slug: shop.slug, services: body.services },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    // Issue tokens immediately — the client stores them and navigates to
    // /shop/dashboard without an extra round-trip.
    const access = await container.auth.issueAccessToken({
      id: owner.id,
      shopId: shop.id,
      role: 'owner',
    });
    const refresh = await container.auth.issueRefreshToken({
      id: owner.id,
      shopId: shop.id,
      role: 'owner',
    });

    return ok({
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.claims.exp - access.claims.iat,
      user: { id: owner.id, email: owner.email, role: 'owner', shopId: shop.id },
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
      },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}

/**
 * GET /api/v1/auth/register/check-slug?slug=foo
 *
 * Lightweight uniqueness probe — used by the registration wizard's "slug"
 * field to show inline availability as the user types.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'slug-check'), 30, 60);
    const slugRaw = req.nextUrl.searchParams.get('slug') ?? '';
    const parsed = ShopSlugSchema.safeParse(slugRaw);
    if (!parsed.success) {
      return ok({ available: false, reason: 'invalid' });
    }
    const slug = parsed.data;
    const taken = await repos.shops.findBySlug(slug);
    if (taken) {
      return ok({ available: false, reason: 'taken', slug });
    }
    return ok({ available: true, slug });
  } catch (cause) {
    // Avoid leaking auth errors — the probe is public.
    if (cause instanceof UnauthorizedError) {
      return ok({ available: false, reason: 'error' });
    }
    return fail(toAppError(cause));
  }
}

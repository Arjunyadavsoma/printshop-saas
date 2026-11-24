import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
} from '@platform/core/errors';
import { createDefaultPricingConfig } from '@platform/core/domain';
import { UpiIdSchema, ShopSlugSchema, IndianPhoneSchema } from '@platform/utils';
import { isUniqueConstraintError } from '@/lib/db/is-unique-constraint-error';

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
 *
 * H10 fix:
 *   1. Reserved slugs (admin, api, shop, login, …) are rejected before any
 *      DB write — previously a malicious shopkeeper could register the slug
 *      `admin` or `api` and effectively squat a reserved route namespace,
 *      causing path-confusion attacks against the platform's own pages.
 *   2. The user + shop creation is wrapped in a try/catch that detects
 *      Prisma P2002 / PostgreSQL 23505 unique-constraint violations and
 *      returns 409 Conflict instead of 500 — closing the TOCTOU race where
 *      two concurrent registrations for the same email/slug both passed the
 *      pre-flight uniqueness check and then one of them failed with an
 *      unhandled 500. The DB UNIQUE index is the authoritative guard; the
 *      pre-flight check is just a friendly UX fast-path.
 */

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'shop',
  'shops',
  'login',
  'register',
  'auth',
  'sw',
  '_next',
  // duplicate entries above are de-duped by the Set; listed explicitly per
  // the audit's request so reviewers can grep each reserved token.
]);

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
  // Payment method customization (shopkeeper selects during registration)
  paymentMethods: z.enum(['upi', 'cash', 'both', 'split']).default('both'),
  // Pamphlet / cover sheet feature.
  // M1 fix: hard-reject `pamphletEnabled: true` at registration too (the
  // PATCH /shops/me route has the same guard). The pricing engine never
  // bills for the pamphlet, so allowing it to be enabled would configure
  // a surcharge that customers are never charged — a ledger mismatch.
  // Use a refine() that fires ONLY when the caller explicitly passes
  // `true`; the default `false` is unaffected.
  pamphletEnabled: z.boolean().refine(
    (v) => v === false,
    { message: 'The pamphlet / cover-sheet feature is not yet billed at checkout. Leave pamphletEnabled disabled.' },
  ).default(false),
  pamphletPricePaise: z.number().int().min(0).max(100000).default(0),
  pamphletName: z.string().max(100).nullable().optional(),
});

const ALLOWED_SERVICES = new Set([
  'bw_print', 'color_print', 'a3_print', 'scan', 'laminate',
  'binding', 'photo_print', 'document_print', 'id_card', 'passport_photo',
]);

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Returns true if the slug is reserved (cannot be registered as a shop URL). */
function isReservedSlug(slug: string): boolean {
  // Compare against the bare slug AND against the slug stripped of any
  // leading/trailing hyphens — `admin`, `-admin-`, `admin-` should all be
  // blocked. The slug already passed ShopSlugSchema (lowercase + alnum +
  // hyphens, 2-60 chars) so we don't need to normalise case here.
  const normalised = slug.replace(/^-+|-+$/g, '');
  if (RESERVED_SLUGS.has(slug) || RESERVED_SLUGS.has(normalised)) return true;
  // Also block any slug that STARTS with a reserved prefix followed by a
  // hyphen (e.g. `admin-shop`, `api-v2`) — these would still shadow the
  // platform's own routes under Next.js' catch-all matching.
  for (const reserved of RESERVED_SLUGS) {
    if (slug.startsWith(`${reserved}-`) || slug.startsWith(`${reserved}_`)) {
      return true;
    }
  }
  return false;
}

/** Map a P2002 / 23505 unique violation to a 409 response. Inspects the
 * Prisma `meta.target` field (when available) to decide whether the
 * duplicate was on `email` or `slug` so the client can show a targeted
 * "this email is already registered" or "this URL is taken" message. */
function conflictResponse(cause: unknown): NextResponse {
  let code = 'CONFLICT';
  let message = 'An account with this email or shop URL already exists. Try logging in instead.';
  if (cause && typeof cause === 'object') {
    const meta = (cause as { meta?: { target?: string[] } }).meta;
    const target = meta?.target;
    if (Array.isArray(target)) {
      if (target.includes('email')) {
        code = 'EMAIL_TAKEN';
        message = 'An account with this email already exists. Try logging in instead.';
      } else if (target.includes('slug')) {
        code = 'SLUG_TAKEN';
        message = 'This shop URL is already in use. Pick a different slug.';
      }
    }
  }
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: 409 },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'register'), 5, 60);
    const body = RegisterSchema.parse(await req.json());

    // H-2 fix: normalise the email to lowercase before any lookup or
    // insert. The user repository ALSO lowercases on create/findByEmail
    // (defense-in-depth), but lowercasing here ensures the audit log,
    // the response body, and the email-taken check all see the canonical
    // form — so a user who registers as `User@Example.com` and later
    // tries to log in as `user@example.com` succeeds.
    body.email = body.email.toLowerCase();

    // Validate service keys against the allowlist.
    const unknown = body.services.filter((s) => !ALLOWED_SERVICES.has(s));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown service: ${unknown.join(', ')}`);
    }

    // H10 fix: reject reserved slugs BEFORE any DB query — `admin`, `api`,
    // `shop`, `login`, etc. must never be registrable. The shopkeeper
    // would otherwise be able to create a shop at `/shops/admin` that
    // shadows the platform's own admin routes.
    if (isReservedSlug(body.slug)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SLUG_RESERVED',
            message: `The URL "/${body.slug}" is reserved and cannot be registered. Pick a different slug.`,
          },
        },
        { status: 409 },
      );
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
    // H10 fix: wrap the user + shop creation in a try/catch that detects
    // Prisma P2002 / PostgreSQL 23505 unique-constraint violations. This
    // closes the TOCTOU race: two concurrent registrations for the same
    // email or slug BOTH pass the pre-flight check above, then ONE of them
    // hits the DB UNIQUE index and throws. Previously that surfaced as a
    // 500 InternalServerError; now it's a clean 409 Conflict.
    let owner;
    let shop;
    try {
      owner = await repos.users.create(
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
      shop = await repos.shops.create({
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
        cashOnPickup: body.paymentMethods === 'cash' || body.paymentMethods === 'both' || body.paymentMethods === 'split',
        paymentMethods: body.paymentMethods,
        pamphletEnabled: body.pamphletEnabled,
        pamphletPricePaise: body.pamphletPricePaise,
        pamphletName: body.pamphletName ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Parameters<typeof repos.shops.create>[0]);
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        // The DB UNIQUE index caught a race the pre-flight check missed.
        return conflictResponse(cause);
      }
      // Non-unique-constraint error — best-effort cleanup first: if we
      // created the owner row but the shop insert failed, delete the
      // orphan user so a retry does not hit EMAIL_TAKEN for a shop that
      // was never created. Then propagate to the outer catch, which
      // surfaces a generic 500 envelope.
      if (owner) {
        try {
          await repos.users.deleteById(owner.id);
        } catch {
          // Cleanup is best-effort — the original error is the one to report.
        }
      }
      throw cause;
    }

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
    // A server misconfiguration (e.g. a bad PAYMENT_ENCRYPTION_KEY) must
    // not surface as a generic "Internal server error" — tell the customer
    // the setup is temporarily unavailable instead of hiding the reason
    // behind a 500. The UI renders error.message verbatim.
    if (cause instanceof Error && /PAYMENT_ENCRYPTION_KEY/.test(cause.message)) {
      console.error('[register] FAILED: server misconfiguration — PAYMENT_ENCRYPTION_KEY invalid');
      return fail(new AppError('Shop setup is temporarily unavailable — please try again later.', 'SERVER_MISCONFIG', 503));
    }
    // Log the FULL error server-side so it shows in Vercel logs — the
    // toAppError envelope strips details from the client response.
    console.error('[register] FAILED:', cause instanceof Error ? cause.message : String(cause));
    if (cause instanceof Error && cause.stack) {
      console.error('[register] stack:', cause.stack.split('\n').slice(0, 5).join('\n'));
    }
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
    // H10 fix: also reject reserved slugs from the inline check — the
    // client should show "reserved" immediately, not let the user submit
    // and get a 409 from the POST.
    if (isReservedSlug(slug)) {
      return ok({ available: false, reason: 'reserved', slug });
    }
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

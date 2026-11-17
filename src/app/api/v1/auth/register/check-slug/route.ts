import { NextResponse, type NextRequest } from 'next/server';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { getContainer } from '@/lib/container';
import { ShopSlugSchema } from '@platform/utils';
import { UnauthorizedError } from '@platform/core/errors';

/**
 * GET /api/v1/auth/register/check-slug?slug=foo
 *
 * Lightweight public slug-availability probe used by the registration wizard
 * to show inline "available" / "taken" feedback as the shopkeeper types their
 * shop URL. The check is purely advisory — a final uniqueness re-check still
 * happens inside POST /api/v1/auth/register before the row is inserted, so a
 * race between two simultaneous registrations for the same slug is still
 * rejected by the register handler (and the DB unique index on `slug`).
 *
 * Returns `{ available: boolean, slug: string }` on success and a soft
 * `{ available: false, reason: 'invalid' | 'reserved' | 'taken' | 'error' }`
 * envelope for non-exceptional cases (invalid slug format, reserved slug,
 * slug already taken, or unexpected probe error) — never throws 5xx for
 * normal user input.
 *
 * H10 fix: the probe now ALSO rejects reserved slugs (`admin`, `api`,
 * `shop`, `login`, etc.) before hitting the DB — so the client shows
 * "reserved" inline immediately, instead of letting the user submit the
 * form and get a 409 from POST /register. The reserved list is kept in
 * sync with the one in register/route.ts.
 *
 * Rate-limited at 30 requests / 60s per IP to prevent slug-enumeration
 * scraping.
 */

/** Reserved slugs — must stay in sync with src/app/api/v1/auth/register/route.ts. */
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
]);

/** Returns true if the slug is reserved (cannot be registered as a shop URL). */
function isReservedSlug(slug: string): boolean {
  const normalised = slug.replace(/^-+|-+$/g, '');
  if (RESERVED_SLUGS.has(slug) || RESERVED_SLUGS.has(normalised)) return true;
  for (const reserved of RESERVED_SLUGS) {
    if (slug.startsWith(`${reserved}-`) || slug.startsWith(`${reserved}_`)) {
      return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'slug-check'), 30, 60);

    const slugRaw = req.nextUrl.searchParams.get('slug') ?? '';
    const parsed = ShopSlugSchema.safeParse(slugRaw);
    if (!parsed.success) {
      return ok({ available: false, reason: 'invalid', slug: slugRaw });
    }
    const slug = parsed.data;

    // H10 fix: reject reserved slugs inline — the user shouldn't be allowed
    // to even submit `admin` or `api` as their shop URL.
    if (isReservedSlug(slug)) {
      return ok({ available: false, reason: 'reserved', slug });
    }

    const taken = await repos.shops.findBySlug(slug);
    if (taken) {
      return ok({ available: false, reason: 'taken', slug });
    }
    return ok({ available: true, slug });
  } catch (cause) {
    // Avoid leaking auth/internal errors — the probe is public. A slug-check
    // failure should never reveal whether an error was due to DB issues vs
    // auth — both surface as a soft "error" reason to the client.
    if (cause instanceof UnauthorizedError) {
      return ok({ available: false, reason: 'error' });
    }
    return fail(toAppError(cause));
  }
}

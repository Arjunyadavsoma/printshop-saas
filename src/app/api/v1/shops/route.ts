import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';

/**
 * Mask a phone number for public display: show the first 4 + last 4 digits,
 * masking the middle with asterisks. E.g. "9876543210" → "9876****3210".
 *
 * H14 fix: the public shops list previously returned the shopkeeper's full
 * phone number to anonymous customers browsing the shop directory. The full
 * number is needed when an order is in-flight (the customer has already
 * paid + is collecting a print), but exposing it on a public directory
 * endpoint enables phone-number harvesting. Masking limits the exposure to
 * the first/last 4 digits — enough to identify the shop by area code +
 * last-4, but not enough to cold-call.
 *
 * Numbers shorter than 8 digits are masked more aggressively (only the last
 * 2 digits shown). Empty/null/undefined → empty string.
 */
function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length < 8) {
    // Short number — mask everything except the last 2 digits.
    const last2 = digits.slice(-2);
    return '*'.repeat(digits.length - 2) + last2;
  }
  const first4 = digits.slice(0, 4);
  const last4 = digits.slice(-4);
  const middle = '*'.repeat(digits.length - 8);
  return `${first4}${middle}${last4}`;
}

/**
 * GET /api/v1/shops — public list of active shops for customer discovery.
 *
 * Returns a paginated list of active shops with their name, slug, address,
 * masked phone, pricing summary, and operational status. Does NOT expose
 * payment credentials, owner PII, or internal config.
 *
 * Query params:
 *   - q: search query (matches name or address, case-insensitive)
 *   - limit: page size (default 20, max 50)
 *   - offset: pagination offset (default 0)
 *
 * H14 fix: previously this route fetched `listActive(limit+1, offset)` and
 * filtered in memory — which meant `pagination.total` and `pagination.hasNext`
 * reflected the UNFILTERED count, not the search-matched count (a search
 * for "delhi" with 0 matches would still report `total: 47, hasNext: true`
 * because the underlying page had shops in it). Now the search query is
 * passed to the repository's `searchActive()` method, which filters at the
 * DB layer (Prisma `OR` + `contains` + `mode: 'insensitive'`) BEFORE
 * pagination. The total count is computed via `countActiveWithQuery()`
 * so it also reflects the search. `hasNext` is derived from
 * `offset + limit < total`.
 *
 * Phone numbers are masked (first 4 + last 4 digits, middle asterisked) to
 * prevent directory-scraping for PII.
 */
export const GET = withRateLimit('shops-list', 60, 60, async (req) => {
  try {
    const url = req.nextUrl;
    const q = (url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

    // H14 fix: filter at the DB layer (searchActive uses Prisma OR + contains),
    // then compute total + hasNext from the search-matched count, not the
    // unfiltered count.
    const page = await repos.shops.searchActive(q, limit, offset);
    const total = await repos.shops.countActiveWithQuery(q);
    const hasNext = offset + limit < total;

    // Live wait estimate per shop (design board 13/31 shows "Open, 6 min
    // wait" on the directory cards). Same formula as the shop landing page:
    // queued sheets × minutes-per-page ÷ online printers, ceil.
    const withStatus = await Promise.all(page.map(async (s) => {
      const minutesPerPageBw = (s as { minutesPerPageBw?: number }).minutesPerPageBw ?? 1;
      const minutesPerPageColor = (s as { minutesPerPageColor?: number }).minutesPerPageColor ?? 2;
      const minPerPp = Math.max(1, Math.round((minutesPerPageBw + minutesPerPageColor) / 2));
      let waitMinutes: number | null = null;
      try {
        const printers = await repos.printers.listForShop(s.id);
        const online = printers.filter((p) => p.enabled && p.status === 'ONLINE');
        if (online.length > 0) {
          const queued = await repos.printJobs.findQueuedByShop(s.id, 50);
          const sheets = queued.reduce((sum, t) => sum + (t.sheetCount ?? 1) * (t.copies ?? 1), 0);
          waitMinutes = Math.ceil((sheets * minPerPp) / online.length);
        }
      } catch { /* status is best-effort — directory must not fail on it */ }
      return {
        ...s,
        isOpen: (s as { isOpen?: boolean }).isOpen ?? true,
        waitMinutes,
      };
    }));

    return ok({
      shops: withStatus.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        address: s.address,
        // H14 fix: mask the phone number on the public list endpoint.
        phone: maskPhone(s.phone),
        upiId: s.upiId,
        paymentProvider: s.paymentProvider,
        subscriptionTier: s.subscriptionTier,
        isActive: s.isActive,
        isOpen: s.isOpen,
        // Live wait estimate (design board 13/31) — null when all printers
        // are offline or the shop has none (card falls back to "Open").
        waitMinutes: s.waitMinutes,
        createdAt: s.createdAt,
        // Pricing summary — base rate per page for bw + color
        pricingSummary: {
          bwA4PerPage: s.pricingConfig?.bw_a4_per_page ?? 200,
          colorA4PerPage: s.pricingConfig?.color_a4_per_page ?? 500,
          minOrderValue: s.pricingConfig?.min_order_value ?? 1000,
        },
      })),
      pagination: { limit, offset, hasNext, total },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

import { withAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { isValidIndianPincode } from '@/lib/location/validation';
import { AppError, ValidationError } from '@platform/core/errors';
import { z } from 'zod';

/**
 * POST /api/v1/shop/location/geocode — geocode a shop address to
 * latitude/longitude via OpenStreetMap Nominatim (no API key).
 *
 * Auth: withAuth(['owner']) — a shopkeeper can only geocode for their
 * own shop's settings page; the result is never persisted here, the
 * client saves it through PATCH /api/v1/shops/me.
 *
 * Body: { address?, city?, state?, pincode? } — at least one part
 * required; a supplied PIN must be a valid Indian PIN.
 *
 * Success: { latitude, longitude, displayName } — coordinates come
 * straight from Nominatim, so a save that uses them may set
 * locationVerified=true. A manual lat/lng entry must NOT do that.
 *
 * Failures: 400 (no query / bad PIN), 404 (Nominatim found nothing),
 * 502 (Nominatim unreachable / timed out). Rate-limited to 10/min per
 * shopkeeper (Nominatim's usage policy asks for at most 1 req/sec).
 */

const GeocodeSchema = z.object({
  address: z.string().max(500).optional().default(''),
  city: z.string().max(100).optional().default(''),
  state: z.string().max(100).optional().default(''),
  pincode: z.string().max(10).optional().default(''),
});

const NominatimResultSchema = z.array(
  z.object({
    lat: z.string(),
    lon: z.string(),
    display_name: z.string(),
  }),
);

export const POST = withAuth(async (req, _ctx, principal) => {
  try {
    await rateLimit(
      getContainer().cache,
      rateKey(req, `geocode:${principal.userId}`),
      10,
      60,
    );
    const body = GeocodeSchema.parse(await req.json());
    if (body.pincode && !isValidIndianPincode(body.pincode)) {
      throw new ValidationError('Enter a 6-digit PIN code starting with 1–9.');
    }
    const query = [body.address, body.city, body.state, body.pincode, 'India']
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
    if (!query || query === 'India') {
      throw new ValidationError('Enter an address, city or PIN code to find on the map.');
    }

    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ format: 'json', limit: '1', addressdetails: '0', q: query }).toString();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          // Nominatim usage policy requires an identifying User-Agent.
          'User-Agent': 'Printelyx/1.0 (shop location lookup)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch (cause) {
      throw new AppError(
        'Could not reach the map service. Check your connection or enter the coordinates manually.',
        'GEOCODE_UNAVAILABLE',
        502,
      );
    }
    if (!res.ok) {
      throw new AppError(
        'The map service is temporarily unavailable. Try again or enter the coordinates manually.',
        'GEOCODE_UNAVAILABLE',
        502,
      );
    }
    const parsed = NominatimResultSchema.safeParse(await res.json());
    if (!parsed.success || parsed.data.length === 0) {
      throw new AppError(
        'No match found for that address. Check the spelling or enter the coordinates manually.',
        'GEOCODE_NO_RESULT',
        404,
      );
    }
    const hit = parsed.data[0];
    const latitude = Number(hit.lat);
    const longitude = Number(hit.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new AppError(
        'The map service returned an unusable result. Enter the coordinates manually.',
        'GEOCODE_UNAVAILABLE',
        502,
      );
    }
    return ok({ latitude, longitude, displayName: hit.display_name });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner']);

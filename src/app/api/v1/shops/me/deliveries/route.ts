import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { getShopDeliveryHistory } from '@/lib/services/delivery-view.service';

/**
 * GET /api/v1/shops/me/deliveries — P2-8 fix: dashboard delivery history.
 *
 * Returns the shop's most recent PrintDeliveryAttempt rows joined with the
 * file name + device name, newest first. Lets the shopkeeper see WHICH
 * device received WHICH file (and any delivery failures) instead of only
 * raw device online/offline status.
 *
 * Query: ?limit=50 (default 50, hard cap 200).
 */
export const GET = withAuth(async (req, _ctx, principal) => {
  try {
    const shop = await repos.shops.getByOwner(principal.userId);
    const url = new URL(req.url);
    const parsed = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    const deliveries = await getShopDeliveryHistory(shop.id, limit);
    return ok(deliveries);
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner', 'staff']);

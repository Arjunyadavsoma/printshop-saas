import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { toNotificationPublic } from '@platform/core/domain';

/**
 * GET /api/v1/me/notifications — list the caller's in-app
 * notifications.
 *
 * Authorization: any authenticated role. The principal's userId is the
 * recipientId (for customers, that's the CustomerAccount.id; for
 * shopkeepers, the User.id). The query filters by recipientId +
 * channel='in_app'.
 *
 * Query params:
 *   - unreadOnly=1 — only unread notifications
 *   - limit — page size (default 50, max 200)
 *   - offset — pagination
 */
export const GET = withAuth(async (req, _ctx, principal) => {
  try {
    const url = req.nextUrl;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
    const unreadOnly = url.searchParams.get('unreadOnly') === '1';

    const notifications = await repos.notifications.listForRecipient(
      principal.userId,
      { limit, offset, unreadOnly },
    );

    return ok({
      notifications: notifications.map(toNotificationPublic),
      pagination: { limit, offset, total: notifications.length },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

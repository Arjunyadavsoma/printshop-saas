import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError, ForbiddenError } from '@platform/core/errors';

/**
 * POST /api/v1/me/notifications/:id/read — mark an in-app
 * notification as read.
 *
 * Authorization: the caller must own the notification (recipientId
 * must equal principal.userId). A notification owned by a different
 * user returns 404 (not 403 — avoid leaking that the notification
 * exists).
 */
export const POST = withAuth<{ id: string }>(async (_req, ctx, principal) => {
  try {
    const { id } = await ctx.params;
    const notification = await repos.notifications.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    // Tenancy: the recipient must be the caller. We don't reveal
    // ownership to a non-owner — return 404.
    if (notification.recipientId !== principal.userId) {
      throw new NotFoundError('Notification not found');
    }
    // Idempotent: marking an already-read notification is a no-op.
    if (notification.readAt) {
      return ok({ ok: true, alreadyRead: true });
    }
    await repos.notifications.markRead(id);
    return ok({ ok: true, alreadyRead: false });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

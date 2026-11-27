import { withAuth } from '@/lib/api/with-auth';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';

/**
 * GET /api/v1/shops/me/gmail/status — Gmail connection status + sync info.
 */
export const GET = withAuth(async (_req, _ctx, principal) => {
  try {
    const shop = await repos.shops.getByOwner(principal.userId);
    const db = getContainer().db;
    const conn = await db.findOne<{
      googleEmail: string;
      status: string;
      lastSyncAt: Date | null;
      syncError: string | null;
      matchedCount: number;
      pendingReviewCount: number;
    }>('shopGmailConnection', { shopId: shop.id });

    if (!conn) {
      return ok({ connected: false });
    }

    return ok({
      connected: true,
      email: conn.googleEmail,
      status: conn.status,
      lastSyncAt: conn.lastSyncAt,
      syncError: conn.syncError,
      matchedCount: conn.matchedCount,
      pendingReviewCount: conn.pendingReviewCount,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner', 'staff']);

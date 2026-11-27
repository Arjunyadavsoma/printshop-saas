import { withAuth } from '@/lib/api/with-auth';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { revokeToken } from '@/lib/payments/gmail-oauth';
import { NotFoundError } from '@platform/core/errors';

/**
 * POST /api/v1/shops/me/gmail/disconnect — revoke Google access + delete connection.
 *
 * On disconnect:
 *   1. Revoke the Google refresh token (best-effort).
 *   2. Delete the ShopGmailConnection record.
 *   3. Preserve PaymentEvidence records (financial audit trail).
 *   4. Stop monitoring (the cron will skip shops without a connection).
 */
export const POST = withAuth(async (_req, _ctx, principal) => {
  try {
    const shop = await repos.shops.getByOwner(principal.userId);
    const db = getContainer().db;
    const conn = await db.findOne<{ id: string; encryptedRefreshToken: string }>('shopGmailConnection', { shopId: shop.id });
    if (!conn) throw new NotFoundError('No Gmail connection found');

    await revokeToken(conn.encryptedRefreshToken);
    await db.delete('shopGmailConnection', { id: conn.id });

    return ok({ disconnected: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}, ['owner']);

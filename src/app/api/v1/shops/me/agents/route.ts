import { withAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

/** GET /api/v1/shops/me/agents — list registered print agents (Phase 6 registers them). */
export const GET = withAuth(async (_req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  const agents = await getContainer().db.findMany<
    { id: string; name: string; isOnline: boolean; lastSeenAt: Date | null; printerName: string | null; version: string | null; os: string | null }
  >('printAgent', { shopId: shop.id }, { order: ['createdAt', 'desc'] });
  return ok(agents);
});

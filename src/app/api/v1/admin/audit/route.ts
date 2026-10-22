import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

/**
 * GET /api/v1/admin/audit — recent audit log entries (admin only).
 * Does NOT expose raw webhook bodies, credentials, or payment payloads.
 */
export const GET = withAuth(async (req) => {
  const url = req.nextUrl;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

  // The AuditLogRepository.findByShop is tenant-scoped; for admin we need all.
  // We use the base findMany via a raw query — but the repos.audit doesn't have
  // a listAll. Let's use findByShop with a broad scan — actually, let's query
  // the recent audit entries by listing from a few shops. For a clean admin
  // view, let's add a listRecent method.
  const recent = await repos.audit.listRecent(limit);

  return ok({
    entries: recent.map((e) => ({
      id: e.id,
      shopId: e.shopId,
      userId: e.userId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: e.metadata,
      ip: e.ip,
      createdAt: e.createdAt,
    })),
  });
}, ['admin']);

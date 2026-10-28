import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';
import { withAuth } from '@/lib/api/with-auth';
import { formatINRFromPaise } from '@platform/utils';

/**
 * GET /api/v1/metrics — basic platform metrics (spec §11):
 *   orders/min, avg print time, payment success rate, active agents, totals.
 *
 * SEC-010 fix: this route exposes total platform revenue, order counts, +
 * payment success rate — sensitive business intelligence. Previously it was
 * PUBLIC (anyone could curl it + learn the platform's revenue + order volume,
 * useful for competitors + for attackers probing for the right attack scale).
 * Now admin-only (the shopkeeper dashboard doesn't use this — it uses the
 * shop-scoped /shops/me/analytics route; this is for the platform admin's
 * operational view).
 */
export const GET = withAuth(async () => {
  const c = getContainer();
  const now = Date.now();
  const windowMs = 60_000;

  // Platform-wide order scan (cap 500 for cheapness on the free tier).
  const orders = await c.db.findMany<{ status: string; totalAmountPaise: number; createdAt: Date; paymentProvider: string | null }>('order', {}, { limit: 500, order: ['createdAt', 'desc'] });

  const ordersLastMin = orders.filter((o) => now - new Date(o.createdAt).getTime() < windowMs).length;
  const paid = orders.filter((o) => o.status !== 'awaiting_payment' && o.status !== 'cancelled');
  const cancelled = orders.filter((o) => o.status === 'cancelled');
  const revenuePaise = paid.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  const attempted = paid.length + cancelled.length;
  const paymentSuccessRate = attempted > 0 ? paid.length / attempted : 0;

  // Avg print time: startedAt → completedAt across completed print jobs.
  const jobs = await c.db.findMany<{ startedAt: Date | null; completedAt: Date | null }>('printJob', { status: 'completed' }, { limit: 200 });
  const printTimes = jobs
    .filter((j) => j.startedAt && j.completedAt)
    .map((j) => j.completedAt!.getTime() - j.startedAt!.getTime());
  const avgPrintMs = printTimes.length > 0 ? printTimes.reduce((a, b) => a + b, 0) / printTimes.length : 0;
  const p95PrintMs = printTimes.length > 0 ? [...printTimes].sort((a, b) => a - b)[Math.floor(printTimes.length * 0.95)] ?? 0 : 0;

  // Active agents (heartbeated within 30s).
  const agents = await c.db.findMany<{ isOnline: boolean; lastSeenAt: Date | null }>('printAgent', {});
  const cutoff = now - 30_000;
  const activeAgents = agents.filter((a) => a.isOnline && a.lastSeenAt && a.lastSeenAt.getTime() >= cutoff).length;

  return ok({
    throughput: { ordersPerMinute: ordersLastMin, totalOrders: orders.length },
    payments: { successRate: paymentSuccessRate, paid: paid.length, cancelled: cancelled.length },
    revenue: { totalPaise: revenuePaise, formatted: formatINRFromPaise(revenuePaise) },
    printing: { avgPrintTimeMs: Math.round(avgPrintMs), p95PrintTimeMs: Math.round(p95PrintMs), completedJobs: jobs.length },
    agents: { active: activeAgents, total: agents.length },
    ts: new Date().toISOString(),
  });
}, ['admin']);

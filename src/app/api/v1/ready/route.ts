import { NextResponse } from 'next/server';
import { getContainer } from '@/lib/container';
import { withRateLimit } from '@/lib/api/with-auth';

interface CheckResult {
  name: string;
  provider: string;
  healthy: boolean;
  latencyMs: number;
}

/**
 * GET /api/v1/ready — readiness probe.
 *
 * Checks every dependency required to serve the application's configured
 * production functionality:
 *  - Database (mandatory): must respond to a ping within 5s.
 *  - Storage (mandatory if STORAGE_PROVIDER != memory): must respond to head
 *    on a known-nonexistent key (returns null quickly = reachable).
 *  - Cache (mandatory if CACHE_PROVIDER != memory): must respond to a get.
 *
 * Optional dev dependencies (memory storage, memory cache, stub email/sms)
 * are NOT checked — they always succeed in-process.
 *
 * Returns 200 if all mandatory deps are healthy, 503 if any are not.
 * Never exposes connection strings, credentials, or stack traces.
 */
export const GET = withRateLimit('ready', 30, 60, async () => {
  const c = getContainer();
  const checks: CheckResult[] = [];

  // ── Database (always mandatory) ──
  const dbStart = Date.now();
  let dbOk = false;
  try {
    dbOk = await withTimeout(c.db.ping(), 5000);
  } catch { dbOk = false; }
  checks.push({ name: 'database', provider: c.db.provider, healthy: dbOk, latencyMs: Date.now() - dbStart });

  // ── Storage (mandatory if not in-memory dev) ──
  const storageMandatory = c.storage.provider !== 'memory';
  if (storageMandatory) {
    const sStart = Date.now();
    let sOk = false;
    try {
      // head on a nonexistent key — returns null quickly if reachable.
      const result = await withTimeout(c.storage.head('__readiness_probe__'), 5000);
      sOk = result === null; // null = not found = reachable (not an error)
    } catch { sOk = false; }
    checks.push({ name: 'storage', provider: c.storage.provider, healthy: sOk, latencyMs: Date.now() - sStart });
  }

  // ── Cache (mandatory if not in-memory dev) ──
  const cacheMandatory = c.cache.provider !== 'memory';
  if (cacheMandatory) {
    const cStart = Date.now();
    let cOk = false;
    try {
      const val = await withTimeout(c.cache.get('__readiness_probe__'), 5000);
      cOk = typeof val === 'string' || val === null; // null is fine (key doesn't exist)
    } catch { cOk = false; }
    checks.push({ name: 'cache', provider: c.cache.provider, healthy: cOk, latencyMs: Date.now() - cStart });
  }

  // ── Realtime (mandatory if socketio relay configured) ──
  const realtimeMandatory = c.realtime.provider !== 'memory';
  if (realtimeMandatory) {
    const rStart = Date.now();
    let rOk = false;
    try {
      // A publish to a noop channel — if it doesn't throw, the relay is reachable.
      // Best-effort: if the relay is down, publish throws/swallows → not ready.
      await withTimeout(c.realtime.publish('__readiness_probe__', 'ping', null), 5000);
      rOk = true;
    } catch { rOk = false; }
    checks.push({ name: 'realtime', provider: c.realtime.provider, healthy: rOk, latencyMs: Date.now() - rStart });
  }

  const allHealthy = checks.every((ch) => ch.healthy);
  return NextResponse.json(
    {
      success: true,
      data: {
        ready: allHealthy,
        checks: checks.map((ch) => ({
          name: ch.name,
          provider: ch.provider,
          healthy: ch.healthy,
          latencyMs: ch.latencyMs,
        })),
      },
    },
    { status: allHealthy ? 200 : 503 },
  );
});

/** Race a promise against a timeout — rejects with an Error if the timeout wins. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

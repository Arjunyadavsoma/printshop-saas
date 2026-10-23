/**
 * Next.js Instrumentation hook — called ONCE per serverless cold start.
 *
 * Used to run startup maintenance that should happen on every fresh instance:
 *   - recoverStaleJobsOnStartup() — flips stuck 'printing' jobs back to
 *     'needs_review' (so a crashed/timeout function doesn't leave jobs
 *     permanently stuck) AND prunes audit logs older than 30 days (keeps
 *     the Neon free-tier DB from filling up).
 *
 * Without this file, recoverStaleJobsOnStartup() is dead code (defined in
 * src/lib/container.ts but never called) — stale jobs stay stuck forever +
 * the audit log grows unbounded.
 *
 * Next.js requires this file at `src/instrumentation.ts` (or project-root
 * `instrumentation.ts`) + `instrumentationHook: true` in next.config (the
 * default in Next.js 16+). The `register()` export runs in the Node.js
 * runtime (NOT edge) before the first request is served.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register(): Promise<void> {
  // Defer to a dynamic import so test environments (which don't always
  // have the DB / container initialized) don't crash on import.
  if (process.env.NODE_ENV === 'test') return;
  try {
    const { recoverStaleJobsOnStartup } = await import('@/lib/container');
    await recoverStaleJobsOnStartup();
  } catch (e) {
    // Non-fatal — the app still serves requests; the maintenance just
    // didn't run this cold start. Log so it's visible in Vercel logs.
    console.error('[instrumentation] startup maintenance failed:', e instanceof Error ? e.message : String(e));
  }
}

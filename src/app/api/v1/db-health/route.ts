import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/v1/db-health
 *
 * Diagnostic endpoint — checks if the database connection works + which
 * tables exist. Returns a JSON report.
 *
 * Security: requires admin JWT OR ?key= matching SETUP_KEY/ADMIN_ACCESS_KEY.
 * Previously public (P1 finding FIND-011) — leaked env-var presence flags
 * + masked DATABASE_URL to unauthenticated callers.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // F-04 fix: Require Bearer header only. No query-string secrets.
  // ADMIN_ACCESS_KEY is independent from SETUP_KEY and CRON_SECRET.
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedKey = process.env.ADMIN_ACCESS_KEY ?? '';
  // Fail-closed: if no ADMIN_ACCESS_KEY configured, reject in production.
  if (!expectedKey || token !== expectedKey) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Admin authentication required.' } },
      { status: 401 },
    );
  }

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    databaseUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@') : 'NOT SET',
    envVars: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      JWT_ACCESS_SECRET: !!process.env.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: !!process.env.JWT_REFRESH_SECRET,
      PAYMENT_ENCRYPTION_KEY: !!process.env.PAYMENT_ENCRYPTION_KEY,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      NODE_ENV: process.env.NODE_ENV ?? 'not set',
    },
  };

  // Test 1: Can we connect + query?
  try {
    const result = await db.$queryRaw`SELECT 1 as test`;
    results.connection = 'OK';
    results.queryTest = result;
  } catch (err) {
    results.connection = 'FAILED';
    results.connectionError = err instanceof Error ? err.message : String(err);
    return NextResponse.json(results, { status: 500 });
  }

  // Test 2: Which tables exist?
  try {
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    results.tables = tables.map(t => t.table_name);
    results.tablesCount = tables.length;
  } catch (err) {
    results.tables = 'FAILED';
    results.tablesError = err instanceof Error ? err.message : String(err);
  }

  // Test 3: Count rows in key tables
  try {
    const userCount = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint as count FROM "User"`;
    const shopCount = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint as count FROM "Shop"`;
    results.userCount = Number(userCount[0]?.count ?? 0);
    results.shopCount = Number(shopCount[0]?.count ?? 0);
  } catch {
    results.userCount = 'table missing';
    results.shopCount = 'table missing';
  }

  return NextResponse.json(results);
}

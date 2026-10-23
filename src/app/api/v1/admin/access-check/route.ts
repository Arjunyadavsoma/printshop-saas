import { NextResponse, type NextRequest } from 'next/server';

/**
 * GET /api/v1/admin/access-check?key=<ADMIN_ACCESS_KEY>
 *
 * Lightweight endpoint that checks if the provided access key matches
 * the ADMIN_ACCESS_KEY env var. Returns 200 if valid, 404 if not.
 *
 * This is NOT an authentication endpoint — it only gates access to the
 * admin LOGIN PAGE (so the page shows a 404 without the key). The real
 * authentication is the email + password login (verified via env vars
 * with constant-time comparison).
 *
 * SECURITY: this is defense-in-depth (obscurity layer). The real security
 * is the admin email + password (set as Vercel secrets). Even if someone
 * finds the access key, they still can't log in without the credentials.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const key = req.nextUrl.searchParams.get('key');
  const adminAccessKey = process.env.ADMIN_ACCESS_KEY;

  // If no ADMIN_ACCESS_KEY env var is set, deny all access (fail-closed).
  if (!adminAccessKey) {
    return new NextResponse(null, { status: 404 });
  }

  // Constant-time comparison.
  const bufA = Buffer.from(key ?? '', 'utf8');
  const bufB = Buffer.from(adminAccessKey, 'utf8');
  if (bufA.length !== bufB.length || !bufA.equals(bufB)) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

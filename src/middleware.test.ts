import { describe, expect, it, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const CLERK_ORIGIN = 'https://clerk.printelyx.cc.cd';

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
});

function cspFor(path: string): string {
  const res = middleware(new NextRequest(`https://printelyx.cc.cd${path}`));
  return res.headers.get('Content-Security-Policy') ?? '';
}

describe('middleware CSP', () => {
  it('allows the Clerk Frontend API origin in script-src and connect-src when Clerk is configured', () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsucHJpbnRlbHl4LmNjLmNkJA';
    const csp = cspFor('/shop/login');
    expect(csp).toContain(`script-src 'self' 'unsafe-inline'`);
    expect(csp).toContain(CLERK_ORIGIN);
    // The origin must be inside both directives, not just somewhere in the header.
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    const connectSrc = csp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '';
    expect(scriptSrc).toContain(CLERK_ORIGIN);
    expect(connectSrc).toContain(CLERK_ORIGIN);
  });

  it('keeps the CSP free of the Clerk origin when Clerk is not configured', () => {
    const csp = cspFor('/shop/login');
    expect(csp).not.toContain(CLERK_ORIGIN);
  });

  it('still blocks /dev pages outside development', () => {
    // In vitest NODE_ENV is 'test', so the /dev gate (non-development) fires.
    const res = middleware(new NextRequest('https://printelyx.cc.cd/dev/foo'));
    expect(res.status).toBe(404);
  });
});

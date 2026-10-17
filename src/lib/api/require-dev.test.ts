import { describe, expect, it, afterEach } from 'vitest';
import { requireDev } from '@/lib/api/require-dev';

/**
 * Dev-route protection regression test.
 *
 * Confirms that requireDev():
 *   - returns null in development (NODE_ENV != production) — dev routes work
 *   - returns a 404 NextResponse in production — dev routes are unreachable
 *
 * This guards the /dev/seed, /dev/orders/:id/mark-paid, /dev/qr,
 * /payments/dev/phonepe/simulate, /payments/dev/paytm/simulate, and
 * /storage/put + /storage/get routes. A previous audit found /dev/qr was
 * missing the guard — now fixed.
 */
describe('requireDev() — dev-route production guard', () => {
  const originalEnv = process.env.NODE_ENV;
  // Cast to a writable record — TS types NODE_ENV as readonly.
  const env = process.env as unknown as Record<string, string | undefined>;

  afterEach(() => {
    // Restore the original NODE_ENV after each test
    if (originalEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalEnv;
    }
  });

  it('returns null in development (dev routes accessible)', () => {
    env.NODE_ENV = 'development';
    const result = requireDev();
    expect(result).toBeNull();
  });

  it('returns null when NODE_ENV is unset (treated as dev)', () => {
    delete env.NODE_ENV;
    const result = requireDev();
    expect(result).toBeNull();
  });

  it('returns a 404 NextResponse in production', async () => {
    env.NODE_ENV = 'production';
    const result = requireDev();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(404);
    const body = await result!.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Not available in production');
  });

  it('the 404 body does NOT leak that the route exists (looks like a normal 404)', async () => {
    env.NODE_ENV = 'production';
    const result = requireDev()!;
    const body = await result.json();
    // The error message is generic "Not available in production" — does NOT
    // reveal the route's purpose or that it exists in dev.
    expect(body.error.message).not.toContain('dev');
    expect(body.error.message).not.toContain('simulate');
    expect(body.error.message).not.toContain('seed');
  });
});

/**
 * Enumerate every dev route and confirm it calls requireDev().
 * This is a static check — if a new dev route is added without the guard,
 * this test will catch it.
 */
describe('Dev-route protection — every /dev/ route must call requireDev()', () => {
  it('all dev route files import and call requireDev()', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');

    // vitest runs from the project root
    const root = process.cwd();
    const devRoutesDir = resolve(root, 'src/app/api/v1/dev');
    const paymentsDevDir = resolve(root, 'src/app/api/v1/payments/dev');
    const storageDir = resolve(root, 'src/app/api/v1/storage');

    function findRouteFiles(dir: string, acc: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          findRouteFiles(full, acc);
        } else if (entry === 'route.ts') {
          acc.push(full);
        }
      }
      return acc;
    }

    const routeFiles = [
      ...findRouteFiles(devRoutesDir),
      ...findRouteFiles(paymentsDevDir),
      ...findRouteFiles(storageDir),
    ];

    expect(routeFiles.length).toBeGreaterThan(0);

    for (const file of routeFiles) {
      const src = readFileSync(file, 'utf8');
      // Every dev/storage route MUST import and call requireDev()
      expect(src, `${file} must import requireDev`).toContain('requireDev');
      expect(src, `${file} must call requireDev()`).toMatch(/requireDev\(\)/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Production SQL logging guard.
 *
 * Verifies that `src/lib/db.ts` does NOT log every SQL query in production.
 * Prisma's `log: ['query']` emits every SQL statement to stdout — noisy in
 * production and unnecessarily exposes query structure. The config should be:
 *   - dev: `['query']` (useful for debugging)
 *   - production: `['warn', 'error']` (only warnings + errors)
 *
 * This is a static source check (not a runtime test) because the PrismaClient
 * is a singleton constructed at module-load time — the log level depends on
 * NODE_ENV at import time, which is hard to test dynamically without module
 * re-import hacks.
 */
describe('Production SQL logging (db.ts)', () => {
  const dbPath = resolve(process.cwd(), 'src/lib/db.ts');
  const src = readFileSync(dbPath, 'utf8');

  it('uses a conditional log level based on NODE_ENV', () => {
    // Must contain a conditional that switches on NODE_ENV
    expect(src).toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
  });

  it('logs ["warn", "error"] in production (NOT ["query"])', () => {
    // The production branch must use warn + error, NOT query
    const prodMatch = src.match(/production['"]\s*\?\s*\[([^\]]+)\]/);
    expect(prodMatch, 'production log level must be a conditional').not.toBeNull();
    const prodLevel = prodMatch![1];
    expect(prodLevel).toContain('warn');
    expect(prodLevel).toContain('error');
    expect(prodLevel).not.toContain('query');
  });

  it('logs ["query"] in development (for debugging)', () => {
    // The dev branch should use query
    const devMatch = src.match(/:\s*\[([^\]]+)\]/);
    expect(devMatch, 'dev log level must be present').not.toBeNull();
    const devLevel = devMatch![1];
    expect(devLevel).toContain('query');
  });

  it('does NOT use an unconditional log: ["query"]', () => {
    // Guard against regression: someone removing the conditional
    expect(src).not.toMatch(/log:\s*\['query'\]\s*[,\n]/);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * AUDIT Phase 5 — permanent CI gates for every public route:
 *   1. zero console errors + zero failed requests
 *   2. no horizontal overflow (document.scrollWidth <= innerWidth)
 *   3. unique <title> + an <h1> per page
 *   4. axe: no serious/critical violations
 *   5. no placeholder strings anywhere (".local", "Coming soon",
 *      "being written", "TODO", "lorem")
 * Run against E2E_BASE (default http://localhost:3000) with a seeded dev
 * server or a production standalone. Chromium only — WebKit needs system
 * libraries this CI image lacks (documented in BUG-LIST could-not-verify).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const ROUTES = ['/', '/about', '/contact', '/help', '/how-it-works', '/pricing', '/privacy', '/refund-policy', '/terms', '/track', '/download-app'];
const PLACEHOLDER_RES = [/\.local/i, /coming soon/i, /being written/i, /\bTODO\b/, /lorem ipsum/i];
const VIEWPORTS = [
  { w: 360, h: 800 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
];

const titles = new Map<string, string>();

test.beforeEach(async ({ context }) => {
  // listen from the start of each navigation
  context.clearCookies();
});

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    test(`smoke ${route} @${vp.w}x${vp.h}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page: Page = await ctx.newPage();
      const consoleErrors: string[] = [];
      const failed: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Capacitor runtime not loaded/.test(m.text())) consoleErrors.push(m.text().slice(0, 120)); });
      page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 120)));
      page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 100)}`); });

      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      expect.soft(consoleErrors, `console errors on ${route}`).toEqual([]);
      expect.soft(failed, `failed requests on ${route}`).toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(0);

      const title = await page.title();
      expect.soft(title.length, `title on ${route}`).toBeGreaterThan(0);
      const prev = titles.get(title);
      expect.soft(prev ?? null, `duplicate title "${title}" on ${route} and ${prev ?? '?'}`).toBeFalsy();
      titles.set(title, route);

      expect.soft(await page.locator('h1').count(), `h1 on ${route}`).toBeGreaterThanOrEqual(1);

      const body = await page.evaluate(() => document.body.innerText);
      for (const re of PLACEHOLDER_RES) {
        expect.soft(re.test(body), `placeholder ${re} on ${route}`).toBe(false);
      }

      // axe (serious/critical gate) — once per route per viewport is cheap
      const axePath = path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
      if (existsSync(axePath)) {
        await page.addScriptTag({ path: axePath });
        const violations = await page.evaluate(async () => {
          const r = await (window as unknown as { axe: { run: (n: Document, o?: object) => Promise<{ violations: Array<{ impact: string | null; id: string }> }> } }).axe.run(document);
          return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
        });
        expect.soft(violations, `axe serious/critical on ${route}`).toEqual([]);
      }
      await ctx.close();
    });
  }
}

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke-public.spec.ts >> smoke /refund-policy @1280x800
- Location: tests/smoke-public.spec.ts:36:5

# Error details

```
Error: duplicate title "Refund policy · Printelyx" on /refund-policy and /refund-policy

expect(received).toBeFalsy()

Received: "/refund-policy"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e3]:
    - heading "Refund policy" [level=1] [ref=e4]
    - generic [ref=e5]:
      - paragraph [ref=e6]: Payment is made directly to the print shop via UPI. Printelyx does not hold or process your money.
      - heading "If prints are incorrect" [level=2] [ref=e7]
      - paragraph [ref=e8]: If your prints have errors caused by the shop (wrong pages, wrong colour, missing pages), ask the shop to reprint them at no charge.
      - heading "If you paid but did not receive prints" [level=2] [ref=e9]
      - paragraph [ref=e10]: Contact the shop directly with your UTR number and order number. If unresolved, contact Printelyx support with the same details.
      - heading "Cancellation" [level=2] [ref=e11]
      - paragraph [ref=e12]: You can cancel an order any time before printing starts. After printing starts, cancellation is at the shop's discretion.
      - heading "Refunds" [level=2] [ref=e13]
      - paragraph [ref=e14]: Refunds are issued directly by the shop to your UPI account. Printelyx facilitates the request but does not process refunds.
  - region "Notifications alt+T"
  - alert [ref=e15]
```

# Test source

```ts
  1  | import { test, expect, type Page } from '@playwright/test';
  2  | import { readFileSync, existsSync } from 'node:fs';
  3  | import path from 'node:path';
  4  | 
  5  | /**
  6  |  * AUDIT Phase 5 — permanent CI gates for every public route:
  7  |  *   1. zero console errors + zero failed requests
  8  |  *   2. no horizontal overflow (document.scrollWidth <= innerWidth)
  9  |  *   3. unique <title> + an <h1> per page
  10 |  *   4. axe: no serious/critical violations
  11 |  *   5. no placeholder strings anywhere (".local", "Coming soon",
  12 |  *      "being written", "TODO", "lorem")
  13 |  * Run against E2E_BASE (default http://localhost:3000) with a seeded dev
  14 |  * server or a production standalone. Chromium only — WebKit needs system
  15 |  * libraries this CI image lacks (documented in BUG-LIST could-not-verify).
  16 |  */
  17 | const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
  18 | const ROUTES = ['/', '/about', '/contact', '/help', '/how-it-works', '/pricing', '/privacy', '/refund-policy', '/terms', '/track', '/download-app'];
  19 | const PLACEHOLDER_RES = [/\.local/i, /coming soon/i, /being written/i, /\bTODO\b/, /lorem ipsum/i];
  20 | const VIEWPORTS = [
  21 |   { w: 360, h: 800 },
  22 |   { w: 390, h: 844 },
  23 |   { w: 768, h: 1024 },
  24 |   { w: 1280, h: 800 },
  25 | ];
  26 | 
  27 | const titles = new Map<string, string>();
  28 | 
  29 | test.beforeEach(async ({ context }) => {
  30 |   // listen from the start of each navigation
  31 |   context.clearCookies();
  32 | });
  33 | 
  34 | for (const route of ROUTES) {
  35 |   for (const vp of VIEWPORTS) {
  36 |     test(`smoke ${route} @${vp.w}x${vp.h}`, async ({ browser }) => {
  37 |       const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  38 |       const page: Page = await ctx.newPage();
  39 |       const consoleErrors: string[] = [];
  40 |       const failed: string[] = [];
  41 |       page.on('console', (m) => { if (m.type() === 'error' && !/Capacitor runtime not loaded/.test(m.text())) consoleErrors.push(m.text().slice(0, 120)); });
  42 |       page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 120)));
  43 |       page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  44 | 
  45 |       await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30000 });
  46 |       await page.waitForTimeout(1500);
  47 | 
  48 |       expect.soft(consoleErrors, `console errors on ${route}`).toEqual([]);
  49 |       expect.soft(failed, `failed requests on ${route}`).toEqual([]);
  50 | 
  51 |       const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  52 |       expect.soft(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(0);
  53 | 
  54 |       const title = await page.title();
  55 |       expect.soft(title.length, `title on ${route}`).toBeGreaterThan(0);
  56 |       const prev = titles.get(title);
> 57 |       expect.soft(prev ?? null, `duplicate title "${title}" on ${route} and ${prev ?? '?'}`).toBeFalsy();
     |                                                                                              ^ Error: duplicate title "Refund policy · Printelyx" on /refund-policy and /refund-policy
  58 |       titles.set(title, route);
  59 | 
  60 |       expect.soft(await page.locator('h1').count(), `h1 on ${route}`).toBeGreaterThanOrEqual(1);
  61 | 
  62 |       const body = await page.evaluate(() => document.body.innerText);
  63 |       for (const re of PLACEHOLDER_RES) {
  64 |         expect.soft(re.test(body), `placeholder ${re} on ${route}`).toBe(false);
  65 |       }
  66 | 
  67 |       // axe (serious/critical gate) — once per route per viewport is cheap
  68 |       const axePath = path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
  69 |       if (existsSync(axePath)) {
  70 |         await page.addScriptTag({ path: axePath });
  71 |         const violations = await page.evaluate(async () => {
  72 |           const r = await (window as unknown as { axe: { run: (n: Document, o?: object) => Promise<{ violations: Array<{ impact: string | null; id: string }> }> } }).axe.run(document);
  73 |           return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  74 |         });
  75 |         expect.soft(violations, `axe serious/critical on ${route}`).toEqual([]);
  76 |       }
  77 |       await ctx.close();
  78 |     });
  79 |   }
  80 | }
  81 | 
```
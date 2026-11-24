# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke-public.spec.ts >> smoke / @390x844
- Location: tests/smoke-public.spec.ts:36:5

# Error details

```
Error: axe serious/critical on /

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "label-content-name-mismatch",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - button "Change theme" [ref=e4] [cursor=pointer]
    - generic [ref=e5]: Printelyx
    - heading "Print without the queue" [level=1] [ref=e7]
    - paragraph [ref=e8]: 1 shops nearby
    - searchbox "Search print shops" [ref=e14]
    - link "Visit QuickPrint Demo Shop" [ref=e16] [cursor=pointer]:
      - /url: /s/quickprint
      - generic [ref=e17]:
        - generic [ref=e18]:
          - generic [ref=e19]: QuickPrint Demo Shop
          - generic [ref=e20]: 12 MG Road
        - generic [ref=e21]: Free
      - generic [ref=e22]:
        - generic [ref=e24]:
          - generic [ref=e25]: B&W ₹2
          - generic [ref=e26]: Colour ₹5
          - generic [ref=e27]: Min ₹10
        - generic [ref=e28]: Visit shop
    - generic [ref=e29]:
      - paragraph [ref=e30]: How it works
      - generic [ref=e32]:
        - text: 1. Find a shop
        - generic [ref=e33]: Or scan the shop's QR code
      - generic [ref=e35]:
        - text: 2. Upload files
        - generic [ref=e36]: PDF, photos, or Word docs
      - generic [ref=e38]:
        - text: 3. Pay by UPI
        - generic [ref=e39]: Direct to shopkeeper, 0% commission
      - generic [ref=e41]:
        - text: 4. Pick up
        - generic [ref=e42]: Show your code at the counter
    - generic [ref=e43]:
      - paragraph [ref=e44]: Run a print shop?
      - paragraph [ref=e45]: Get your QR code and start taking orders.
      - link "Register your shop" [ref=e46] [cursor=pointer]:
        - /url: /shop/register
      - link "Shopkeeper login" [ref=e48] [cursor=pointer]:
        - /url: /shop/login
    - contentinfo [ref=e49]:
      - generic [ref=e50]: Printelyx — 0% commission
      - generic [ref=e51]:
        - link "Help" [ref=e52] [cursor=pointer]:
          - /url: /help
        - link "About" [ref=e53] [cursor=pointer]:
          - /url: /about
        - link "Contact" [ref=e54] [cursor=pointer]:
          - /url: /contact
  - region "Notifications alt+T"
  - alert [ref=e55]
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
  57 |       expect.soft(prev ?? null, `duplicate title "${title}" on ${route} and ${prev ?? '?'}`).toBeFalsy();
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
> 75 |         expect.soft(violations, `axe serious/critical on ${route}`).toEqual([]);
     |                                                                     ^ Error: axe serious/critical on /
  76 |       }
  77 |       await ctx.close();
  78 |     });
  79 |   }
  80 | }
  81 | 
```
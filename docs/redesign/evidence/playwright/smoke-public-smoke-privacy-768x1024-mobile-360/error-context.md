# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke-public.spec.ts >> smoke /privacy @768x1024
- Location: tests/smoke-public.spec.ts:36:5

# Error details

```
Error: duplicate title "Privacy · Printelyx" on /privacy and /privacy

expect(received).toBeFalsy()

Received: "/privacy"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e5]:
        - heading "Privacy" [level=1] [ref=e7]
        - paragraph [ref=e8]: What we collect, and what we don't
    - main [ref=e9]:
      - paragraph [ref=e11]: Printelyx is built so that you pay the shop directly — we never handle your money, and your files are deleted automatically. This page explains what data we touch and how long we keep it.
      - list [ref=e12]:
        - listitem [ref=e13]:
          - article [ref=e14]:
            - generic [ref=e20]:
              - heading "What we collect" [level=2] [ref=e21]
              - paragraph [ref=e22]: Your phone number (optional — only if you choose to share it), your uploaded files (temporarily), and your order details (shop, file names, page counts, totals, status).
        - listitem [ref=e23]:
          - article [ref=e24]:
            - generic [ref=e30]:
              - heading "What we don't collect" [level=2] [ref=e31]
              - paragraph [ref=e32]: Your payment details. You pay the shop directly via UPI — we never see your card number, UPI PIN, or the contents of your UPI app. The 12-digit UTR you submit is shared only with the shop you ordered from, so they can match it against their payment receipt.
        - listitem [ref=e33]:
          - article [ref=e34]:
            - generic [ref=e43]:
              - heading "Data sharing" [level=2] [ref=e44]
              - paragraph [ref=e45]: We do not share your data with anyone except the shop you ordered from. We do not sell your data. We do not use it for advertising. The shop sees your order, your files (until deletion), and any contact details you provided — they need this to print your order.
        - listitem [ref=e46]:
          - article [ref=e47]:
            - generic [ref=e52]:
              - heading "Analytics" [level=2] [ref=e53]
              - paragraph [ref=e54]: We use privacy-friendly analytics to count page visits and aggregate order volume. No personal data, no file names, and no UTR numbers are tracked. We cannot identify you from our analytics data.
        - listitem [ref=e55]:
          - article [ref=e56]:
            - generic [ref=e63]:
              - heading "Your rights" [level=2] [ref=e64]
              - paragraph [ref=e65]: You can request deletion of your data at any time by contacting the shop you ordered from. They will mark your order as "delete on next cleanup" and your files will be purged within 24 hours. For privacy questions, use the Contact page.
      - region "Exactly how long we keep things" [ref=e66]:
        - heading "Exactly how long we keep things" [level=2] [ref=e67]
        - table [ref=e69]:
          - rowgroup [ref=e70]:
            - row [ref=e71]:
              - columnheader "Data" [ref=e72]
              - columnheader "Kept" [ref=e73]
              - columnheader "After that" [ref=e74]
          - rowgroup [ref=e75]:
            - row [ref=e76]:
              - cell "Uploaded files" [ref=e77]
              - cell "Until pickup, max 7 days" [ref=e78]
              - cell "Deleted automatically from storage" [ref=e79]
            - row [ref=e80]:
              - cell "Normalized print PDFs" [ref=e81]
              - cell "With the order" [ref=e82]
              - cell "Deleted with the order files" [ref=e83]
            - row [ref=e84]:
              - cell "Order metadata (totals, status, timestamps)" [ref=e85]
              - cell "90 days" [ref=e86]
              - cell "Aggregated and anonymised for accounting" [ref=e87]
            - row [ref=e88]:
              - cell "Payment UTR (the 12-digit reference)" [ref=e89]
              - cell "With the order" [ref=e90]
              - cell "Deleted with order metadata" [ref=e91]
            - row [ref=e92]:
              - cell "Analytics events (page views, order volume)" [ref=e93]
              - cell "Aggregates only" [ref=e94]
              - cell "No personal data stored at all" [ref=e95]
      - paragraph [ref=e96]: This policy was last updated on 24 November 2026. If we make material changes, we will surface a banner on the home page.
      - navigation [ref=e97]:
        - link "Home" [ref=e98] [cursor=pointer]:
          - /url: /
        - link "Contact" [ref=e99] [cursor=pointer]:
          - /url: /contact
        - link "Help" [ref=e100] [cursor=pointer]:
          - /url: /help
  - region "Notifications alt+T"
  - alert [ref=e101]
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
     |                                                                                              ^ Error: duplicate title "Privacy · Printelyx" on /privacy and /privacy
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
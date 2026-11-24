# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke-public.spec.ts >> smoke /help @1280x800
- Location: tests/smoke-public.spec.ts:36:5

# Error details

```
Error: duplicate title "Help · Printelyx" on /help and /help

expect(received).toBeFalsy()

Received: "/help"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e5]:
        - heading "Help" [level=1] [ref=e7]
        - paragraph [ref=e8]: Frequently asked questions
    - main [ref=e9]:
      - region "Frequently asked questions" [ref=e10]:
        - heading "Frequently asked questions" [level=2] [ref=e11]
        - list [ref=e12]:
          - listitem [ref=e13]:
            - generic [ref=e14]:
              - button "How do I pay?" [ref=e15]
              - region "How do I pay?":
                - paragraph [ref=e19]: Tap a UPI app (GPay, PhonePe, Paytm). After paying, enter the 12-digit UTR number from your payment receipt. The shop verifies it — Printelyx never touches your money.
          - listitem [ref=e20]:
            - generic [ref=e21]:
              - button "When will my prints be ready?" [ref=e22]
              - region "When will my prints be ready?":
                - paragraph [ref=e26]: Most orders are ready in 10–20 minutes. Check the tracking page for live status — you will see the step change from "Printing" to "Ready".
          - listitem [ref=e27]:
            - generic [ref=e28]:
              - button "Is my payment safe?" [ref=e29]
              - region "Is my payment safe?":
                - paragraph [ref=e33]: You pay the shop directly via UPI. Printelyx does not handle your money — 0% commission, no middleman. We never see your card or UPI PIN.
          - listitem [ref=e34]:
            - generic [ref=e35]:
              - button "Are my files private?" [ref=e36]
              - region "Are my files private?":
                - paragraph [ref=e40]: Yes. Files are deleted 24 hours after you pick up your prints. If you do not pick up within 7 days, files are deleted automatically. See the Privacy page for the full policy.
          - listitem [ref=e41]:
            - generic [ref=e42]:
              - button "Can I cancel?" [ref=e43]
              - region "Can I cancel?":
                - paragraph [ref=e47]: Yes, but only before printing starts. Tap "Cancel order" on the tracking page. Once printing has begun, the shop has already used paper and ink.
          - listitem [ref=e48]:
            - generic [ref=e49]:
              - button "I paid but it says pending" [ref=e50]
              - region "I paid but it says pending":
                - paragraph [ref=e54]: The shop needs to verify your payment manually. Wait 1–2 minutes, or call the shop using the "Call shop" button on the tracking page. If the UTR was rejected, you can re-enter the correct one.
          - listitem [ref=e55]:
            - generic [ref=e56]:
              - button "What if I cannot find my order?" [ref=e57]
              - region "What if I cannot find my order?":
                - paragraph [ref=e61]: Open the link from your receipt, or go to /orders to see recent orders on this device. If you paid by UPI, the UTR is on your UPI app's payment receipt.
          - listitem [ref=e62]:
            - generic [ref=e63]:
              - button "What does \"Urgent\" mean?" [ref=e64]
              - region "What does \"Urgent\" mean?":
                - paragraph [ref=e68]: Marking an order urgent puts it ahead of the queue. The shop may charge a small surcharge. Use it only when you genuinely need prints in the next few minutes.
      - region "Contact the shop" [ref=e69]:
        - heading "Contact the shop" [level=2] [ref=e70]
        - paragraph [ref=e71]: For order-specific questions (status, payment verification, file changes), call the shop directly from your order tracking page.
        - link "Find my order" [ref=e72] [cursor=pointer]:
          - /url: /orders
      - region "Report a problem" [ref=e75]:
        - heading "Report a problem" [level=2] [ref=e76]
        - paragraph [ref=e77]: Tell us what went wrong. If your report is about a specific order, include the order token from the tracking page URL so we can investigate faster.
        - paragraph [ref=e78]: In-app support is being set up. For now, ask the shop directly — the tracking page has a Call shop button.
      - navigation [ref=e79]:
        - link "Home" [ref=e80] [cursor=pointer]:
          - /url: /
        - link "My orders" [ref=e81] [cursor=pointer]:
          - /url: /orders
        - link "Privacy" [ref=e82] [cursor=pointer]:
          - /url: /privacy
  - region "Notifications alt+T"
  - alert [ref=e83]
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
     |                                                                                              ^ Error: duplicate title "Help · Printelyx" on /help and /help
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
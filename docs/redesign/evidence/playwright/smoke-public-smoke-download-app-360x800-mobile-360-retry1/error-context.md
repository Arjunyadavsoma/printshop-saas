# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke-public.spec.ts >> smoke /download-app @360x800
- Location: tests/smoke-public.spec.ts:36:5

# Error details

```
Error: console errors on /download-app

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "Loading the image 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=https%3A%2F%2Fgithub.com%2FArjunyadavso",
+   "Loading the image 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=https%3A%2F%2Fgithub.com%2FArjunyadavso",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: P
      - heading "Printelyx Companion" [level=1] [ref=e7]
      - paragraph [ref=e8]: The Android app that integrates with your print shop — native camera scanning, UPI payment, and order-ready notifications.
      - generic [ref=e9]:
        - generic [ref=e12]: Android 7.0+ (API 24+)
        - generic [aria-hidden] [ref=e13]: ·
        - generic [ref=e14]: ~8 MB APK
    - generic [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]: Download the APK
        - generic [ref=e21]: The APK is built automatically on every push to the main branch via GitHub Actions.
      - generic [ref=e23]:
        - generic [ref=e24]:
          - img "QR code linking to the APK download" [ref=e26]
          - paragraph [ref=e27]: Scan to download on your phone
        - generic [ref=e34]:
          - link [ref=e35] [cursor=pointer]:
            - /url: https://github.com/Arjunyadavsoma/printshop-saas/releases/latest
            - button "Download APK" [ref=e36]
          - generic [ref=e37]:
            - paragraph [ref=e38]:
              - text: "Source:"
              - generic [ref=e42]: GitHub Releases (latest build)
            - paragraph [ref=e43]:
              - text: "Integrity:"
              - generic [ref=e47]: compare the checksum on the release page
          - link "View release notes and checksum on GitHub" [ref=e48] [cursor=pointer]:
            - /url: https://github.com/Arjunyadavsoma/printshop-saas/releases/latest
    - generic [ref=e53]:
      - generic [ref=e54]:
        - generic [ref=e55]: Install instructions
        - generic [ref=e56]: Android requires explicit permission to install apps from outside the Play Store.
      - list [ref=e58]:
        - listitem [ref=e59]:
          - generic [ref=e60]: "1"
          - generic [ref=e61]:
            - paragraph [ref=e62]: Download the APK
            - paragraph [ref=e63]: Tap "Download APK" above or scan the QR code with your phone camera.
        - listitem [ref=e64]:
          - generic [ref=e65]: "2"
          - generic [ref=e66]:
            - paragraph [ref=e67]: Open the downloaded file
            - paragraph [ref=e68]: Tap the notification or find it in your Downloads folder.
        - listitem [ref=e69]:
          - generic [ref=e70]: "3"
          - generic [ref=e71]:
            - paragraph [ref=e72]: Allow install from this source
            - paragraph [ref=e73]: Android will prompt "For your security, your phone is not allowed to install unknown apps from this source." Tap Settings → enable "Allow from this source".
        - listitem [ref=e74]:
          - generic [ref=e75]: "4"
          - generic [ref=e76]:
            - paragraph [ref=e77]: Install
            - paragraph [ref=e78]: Tap "Install" and wait ~10 seconds for the installation to complete.
        - listitem [ref=e79]:
          - generic [ref=e80]: "5"
          - generic [ref=e81]:
            - paragraph [ref=e82]: Open Printelyx Companion
            - paragraph [ref=e83]: Find it in your app drawer. The app loads your print shop's web app with native camera + UPI + notifications.
    - generic [ref=e84]:
      - generic [ref=e92]:
        - paragraph [ref=e93]: Native camera scanning
        - paragraph [ref=e94]: Scan physical documents directly with your phone camera — no browser file picker.
      - generic [ref=e101]:
        - paragraph [ref=e102]: Direct UPI payment
        - paragraph [ref=e103]: Checkout launches your installed UPI app (PhonePe, GPay, Paytm) via native Android Intent.
      - generic [ref=e111]:
        - paragraph [ref=e112]: Order-ready notifications
        - paragraph [ref=e113]: Get a push notification when your prints are ready for pickup — no polling required.
      - generic [ref=e121]:
        - paragraph [ref=e122]: Secure token storage
        - paragraph [ref=e123]: Auth tokens stored in Android app-private Preferences (sandboxed) — not browser localStorage.
    - link "Back to the web app" [ref=e125] [cursor=pointer]:
      - /url: /
  - region "Notifications alt+T"
  - alert [ref=e128]
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
> 48 |       expect.soft(consoleErrors, `console errors on ${route}`).toEqual([]);
     |                                                                ^ Error: console errors on /download-app
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
  75 |         expect.soft(violations, `axe serious/critical on ${route}`).toEqual([]);
  76 |       }
  77 |       await ctx.close();
  78 |     });
  79 |   }
  80 | }
  81 | 
```
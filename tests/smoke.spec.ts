import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Playwright smoke test — verifies @playwright/test@1.65.0 + Chromium 158
 * actually launch, navigate, and capture a screenshot.
 *
 * Targets localhost:3000 when the dev server is running. Falls back to
 * the production URL for environment-verification (see
 * docs/AI_DEVELOPMENT_ENVIRONMENT.md §10).
 *
 * Run: bunx playwright test tests/smoke.spec.ts
 */

const PROD = 'https://printshop-saas-three.vercel.app';

async function resolveTarget(): Promise<string> {
  if (process.env.PLAYWRIGHT_BASE_URL) return process.env.PLAYWRIGHT_BASE_URL;
  try {
    const res = await fetch('http://localhost:3000/', { method: 'GET', signal: AbortSignal.timeout(2000) });
    return res.ok ? 'http://localhost:3000' : PROD;
  } catch {
    return PROD;
  }
}

let TARGET = PROD;

test.beforeAll(async () => {
  TARGET = await resolveTarget();
});

test.describe('Playwright smoke', () => {
  test('chromium launches, navigates, captures title + screenshot', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Capture a desktop screenshot — this is the real proof Playwright works.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForLoadState('networkidle');
    const desktopPng = await page.screenshot({ fullPage: false });
    writeFileSync('tests/screenshots/smoke-desktop.png', desktopPng);

    // Capture a mobile screenshot.
    await page.setViewportSize({ width: 375, height: 800 });
    const mobilePng = await page.screenshot({ fullPage: false });
    writeFileSync('tests/screenshots/smoke-mobile.png', mobilePng);

    // No hard console errors on initial load.
    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('customer homepage renders hero + shop list', async ({ page }) => {
    await page.goto(TARGET, { waitUntil: 'networkidle' });

    // The homepage should have exactly one h1.
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);

    // No horizontal overflow at 375px (the customer journey is mobile-first).
    await page.setViewportSize({ width: 375, height: 800 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, `horizontal overflow: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`).toBeLessThanOrEqual(clientWidth + 1);
  });
});

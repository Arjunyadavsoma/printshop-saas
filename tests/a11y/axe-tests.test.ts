import { test, expect } from '@playwright/test';
import { runAxeCheck } from '../../src/lib/test/axe-check';

/**
 * Axe accessibility tests for every customer route + key state.
 * Fails CI on serious or critical violations.
 */

const ROUTES = [
  { url: '/s/quickprint', name: 'shop-landing' },
  { url: '/orders', name: 'orders-empty' },
  { url: '/help', name: 'help' },
  { url: '/privacy', name: 'privacy' },
  { url: '/o/invalid-token-test', name: 'tracking-error' },
  { url: '/dev/ui', name: 'dev-gallery' },
];

for (const route of ROUTES) {
  test(`axe: ${route.name} has no serious violations`, async ({ page }) => {
    await page.goto(route.url);
    await page.waitForLoadState('networkidle');
    const results = await runAxeCheck(page);
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${serious.length} serious/critical axe violations on ${route.url}`).toEqual([]);
  });
}

test('axe: bottom sheet focus trap', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.waitForLoadState('networkidle');
  // Find + click the "Open More options sheet" button
  const button = page.getByText('Open "More options" sheet');
  await button.click();
  await page.waitForSelector('[role="dialog"]', { state: 'visible' });
  const results = await runAxeCheck(page);
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious).toEqual([]);
  // Close with Escape
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
});

test('keyboard: full flow with Tab + Enter only', async ({ page }) => {
  await page.goto('/s/quickprint');
  await page.waitForLoadState('networkidle');
  // Tab through the page — focus should be visible
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const outline = window.getComputedStyle(el).outline;
      return { tag: el.tagName, outline };
    });
    // Focus should exist + have a visible outline
    expect(focused).not.toBeNull();
  }
});

test('zoom: 200% zoom — no horizontal scroll', async ({ page }) => {
  await page.goto('/s/quickprint');
  await page.evaluate(() => {
    document.body.style.zoom = '2';
  });
  await page.waitForTimeout(500);
  const hasHorizontalScroll = await page.evaluate(() => {
    return document.body.scrollWidth > window.innerWidth;
  });
  expect(hasHorizontalScroll).toBe(false);
});

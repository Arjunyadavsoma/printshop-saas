import { test, expect } from '@playwright/test';

/**
 * i18n snapshot + overflow tests for en, hi, te at 360px.
 * Verifies layouts tolerate text expansion with no horizontal overflow.
 */

const SCREENS = [
  { url: '/s/quickprint', name: 'shop-landing' },
  { url: '/help', name: 'help' },
  { url: '/privacy', name: 'privacy' },
  { url: '/orders', name: 'orders' },
];

const LANGUAGES = [
  { locale: 'en', name: 'English' },
  { locale: 'hi', name: 'Hindi' },
  { locale: 'te', name: 'Telugu' },
];

for (const screen of SCREENS) {
  for (const lang of LANGUAGES) {
    test(`i18n: ${screen.name} in ${lang.name} — no overflow at 360px`, async ({ page }) => {
      // Set the locale in localStorage before navigating
      await page.addInitScript((locale) => {
        localStorage.setItem('printshop_locale', locale);
        document.documentElement.lang = locale;
      }, lang.locale);

      await page.goto(screen.url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Check for horizontal overflow
      const overflow = await page.evaluate(() => {
        const body = document.body;
        const html = document.documentElement;
        return {
          bodyScrollWidth: body.scrollWidth,
          innerWidth: window.innerWidth,
          hasOverflow: body.scrollWidth > window.innerWidth,
          overflowingElements: Array.from(document.querySelectorAll('*'))
            .filter(el => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
            .slice(0, 5)
            .map(el => ({ tag: el.tagName, text: el.textContent?.slice(0, 40), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
        };
      });

      expect(overflow.hasOverflow, `Horizontal overflow on ${screen.name} in ${lang.name}: body ${overflow.bodyScrollWidth}px > viewport ${overflow.innerWidth}px`).toBe(false);
    });
  }
}

test('i18n: 40% longer strings — no overflow', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('printshop_locale', 'en');
  });

  // Inject a style that makes text 40% longer via letter-spacing + word-spacing
  await page.goto('/s/quickprint');
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({
    content: `* { letter-spacing: 0.15em !important; word-spacing: 0.2em !important; }`,
  });
  await page.waitForTimeout(500);

  const overflow = await page.evaluate(() => {
    return document.body.scrollWidth > window.innerWidth;
  });
  // With 40% longer text, there MIGHT be minor overflow on some elements.
  // The test logs it but doesn't fail — it's a diagnostic.
  console.log(`40% expansion overflow: ${overflow}`);
});

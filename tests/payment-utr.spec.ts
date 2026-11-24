import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * AUDIT P0-1 regression — "I've paid" UTR entry.
 *
 * BEFORE (bug): tapping "I've paid" called window.prompt(), which never
 * appears in automated browsers and is suppressed by several mobile
 * in-app browsers — the customer could not submit their UTR.
 * AFTER (fix): an inline bottom-sheet with a labelled 12-digit input,
 * Cancel + Submit. Submit posts the SAME API contract
 * (POST /api/v1/o/{token}/payment) and moves to the waiting screen.
 *
 * Requires a running dev server with the seeded demo shop
 * (E2E_BASE, default http://localhost:3000).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const PDF = path.join(process.env.E2E_PDF_DIR || '/tmp/journey-files', 'valid-3p.pdf');

test('customer can enter UTR inline after tapping I have paid', async ({ page }) => {
  await page.goto(`${BASE}/s/quickprint`, { waitUntil: 'networkidle' });
  await page.getByText('Add files to print').first().click();

  // upload a small valid PDF and wait for processing to finish
  await page.locator('input[type="file"]').first().setInputFiles(PDF);
  await page.getByText('Ready').first().waitFor({ state: 'visible', timeout: 45000 });

  // files → options (default preset: Mix) → colour-pages screen → review.
  // The options CTA is "Choose colour pages"; the colour-pages screen's
  // bottom bar holds the Review button that advances to the review screen.
  await page.locator('button:not([disabled]):has-text("Continue")').first().click();
  await page.locator('button:not([disabled]):has-text("Choose colour pages")').first().click();
  await page.locator('button:not([disabled]):has-text("Review")').first().click({ timeout: 20000 });

  // review requires a mobile number before Pay unlocks
  const mobile = page.locator('input[type="tel"], input[placeholder*="mobile" i]').first();
  if (await mobile.count()) await mobile.fill('9876543210');
  await page.locator('button:not([disabled]):has-text("Pay")').first().click();
  await expect(page.getByRole('button', { name: "I've paid" })).toBeVisible({ timeout: 15000 });

  // THE FIX: tapping "I've paid" reveals an INLINE UTR input (no prompt())
  await page.getByRole('button', { name: "I've paid" }).click();
  const utrInput = page.getByLabel('12-digit UTR');
  await expect(utrInput).toBeVisible({ timeout: 5000 });

  // fewer than 12 digits → Submit disabled
  await utrInput.fill('12345');
  await expect(page.locator('button:not([disabled]):has-text("Submit")')).toHaveCount(0);

  // a full UTR submits and moves to the waiting screen
  await utrInput.fill('123456789012');
  await page.locator('button:not([disabled]):has-text("Submit")').first().click();
  await expect(page.getByText('Waiting for the shop')).toBeVisible({ timeout: 15000 });
});

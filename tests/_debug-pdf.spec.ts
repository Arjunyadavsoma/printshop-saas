import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Debug-only PDF load test — NOT part of the consumer journey suite.
 *
 * Phase 6.4: this test is `test.skip` because:
 *   - It uses the old aria-label selector `getByRole('button', { name: /
 *     Visit .+ — .+/i })` which was removed in Phase 6.3 (the axe-core
 *     label-content-name-mismatch fix). The shop cards no longer have an
 *     aria-label — their visible shop name serves as the accessible name.
 *   - It's a developer-debug harness (logs console messages + saves a
 *     screenshot to /tmp) — not a regression test. The real PDF preview
 *     E2E is in tests/consumer-journey.spec.ts (PDF preview controls).
 *
 * Kept in the repo as documentation of the debug path. Run manually after
 * updating the selector if you need to exercise it.
 */
const TARGET = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

test.skip('debug PDF load', async ({ page }) => {
  // Capture console messages
  page.on('console', (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => console.log(`[reqfailed] ${req.url()} - ${req.failure()?.errorText}`));

  await page.goto(TARGET, { waitUntil: 'networkidle' });
  // Click first shop card
  await page.getByRole('button', { name: /Visit .+ — .+/i }).first().click();
  await page.waitForURL(/\/shops\/[^/]+$/);
  await page.getByRole('button', { name: /Start order/i }).first().click();
  await page.waitForURL(/\/orders\/[^/]+/, { timeout: 15_000 });

  // Upload PDF
  const pdfPath = path.resolve(__dirname, 'fixtures', 'sample-3-page.pdf');
  await page.locator('input[type="file"]').setInputFiles(pdfPath);

  // Wait for upload
  await expect(page.getByText(/\b3 pages\b/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Configure files/i })).toBeEnabled({ timeout: 30_000 });

  // Click Configure files
  await page.getByRole('button', { name: /Configure files/i }).click();

  // Wait a bit for PdfPreview to load
  await page.waitForTimeout(10000);

  // Take a screenshot
  await page.screenshot({ path: '/tmp/pdf-debug.png', fullPage: true });
  console.log('[screenshot] saved to /tmp/pdf-debug.png');

  // Check what's visible
  const bodyText = await page.locator('body').innerText();
  console.log('[body text]:', bodyText.substring(0, 2000));
});

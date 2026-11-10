import { test, expect } from '@playwright/test';
import path from 'node:path';

const TARGET = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

test('debug PDF load', async ({ page }) => {
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

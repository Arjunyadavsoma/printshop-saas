import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
 * Requires a running server with at least one active seeded shop
 * (E2E_BASE, default http://localhost:3000). The shop slug is resolved at
 * runtime from the shops API so the test survives seed-data changes; the
 * 3-page PDF fixture is generated on the fly if the file is missing (CI
 * runners start with an empty /tmp).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const PDF_DIR = process.env.E2E_PDF_DIR || '/tmp/journey-files';
const PDF = path.join(PDF_DIR, 'valid-3p.pdf');

/** Minimal valid 3-page PDF (same content as the parse-page-count unit fixture). */
function minimal3PagePdf(): Uint8Array {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000176 00000 n 
0000000237 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
298
%%EOF`;
  return new TextEncoder().encode(content);
}

if (!existsSync(PDF)) {
  mkdirSync(PDF_DIR, { recursive: true });
  writeFileSync(PDF, minimal3PagePdf());
}

test('customer can enter UTR inline after tapping I have paid', async ({ page, request }) => {
  // Resolve any active seeded shop at runtime (slug differs between seeds).
  const shopsRes = await request.get(`${BASE}/api/v1/shops?limit=5`);
  expect(shopsRes.ok(), 'shops API reachable').toBeTruthy();
  const shops: Array<{ slug: string; isActive: boolean }> = (await shopsRes.json())?.data?.shops ?? [];
  const slug = shops.find((s) => s.isActive)?.slug;
  test.skip(!slug, 'no active shop seeded');
  await page.goto(`${BASE}/s/${slug}`, { waitUntil: 'networkidle' });
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

  // a full UTR submits and moves to the waiting screen. The UTR is unique
  // per run: the server rejects a reference already submitted for another
  // order in the same shop (P0-1 requirement), so a hardcoded UTR would
  // fail every run after the first.
  const utr = String(Date.now() % 1_000_000_000_000).padStart(12, '0');
  await utrInput.fill(utr);
  await page.locator('button:not([disabled]):has-text("Submit")').first().click();
  await expect(page.getByText('Waiting for the shop')).toBeVisible({ timeout: 15000 });
});

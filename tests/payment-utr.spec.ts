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
  // Resolve a seeded shop that actually accepts orders at runtime (slug and
  // payment mode differ between seeds — e.g. leftover test shops may be
  // active but counter-payment/closed). Try the first active shops until
  // one shows the upload CTA.
  const shopsRes = await request.get(`${BASE}/api/v1/shops?limit=5`);
  expect(shopsRes.ok(), 'shops API reachable').toBeTruthy();
  const shops: Array<{ slug: string; isActive: boolean }> = (await shopsRes.json())?.data?.shops ?? [];
  const candidates = shops.filter((s) => s.isActive).slice(0, 3).map((s) => s.slug);
  test.skip(candidates.length === 0, 'no active shop seeded');

  let slug = candidates[0]!;
  for (const candidate of candidates) {
    await page.goto(`${BASE}/s/${candidate}`, { waitUntil: 'networkidle' });
    const cta = page.getByText('Add files to print').first();
    if (await cta.isVisible({ timeout: 4000 }).catch(() => false)) {
      slug = candidate;
      break;
    }
  }
  await page.goto(`${BASE}/s/${slug}`, { waitUntil: 'networkidle' });
  // The landing shows an "Add files to print" CARD whose CTA is the
  // "Add files" button (setStarted) — the flow's dropzone mounts only
  // after that button. Clicking the card heading does nothing, which is
  // what silently stalled this journey at setInputFiles.
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 20000 });

  // upload a small valid PDF and wait for processing to finish
  await page.locator('input[type="file"]').first().setInputFiles(PDF);
  await page.getByText('Ready').first().waitFor({ state: 'visible', timeout: 45000 });

  // files → options (default preset: Mix) → colour-pages screen → review.
  // NOTE: in the rebuilt flow BOTH the files and options steps use a
  // "Continue" CTA — step 2 IS the review screen (no separate Review
  // button, unlike the earlier design).
  await page.locator('button:not([disabled]):has-text("Continue")').first().click();
  await page.locator('button:not([disabled]):has-text("Choose colour pages")').first().click();
  await page.locator('button:not([disabled]):has-text("Continue")').first().click({ timeout: 20000 });

  // review requires a mobile number before Pay unlocks
  const mobile = page.locator('input[type="tel"], input[placeholder*="mobile" i]').first();
  if (await mobile.count()) await mobile.fill('9876543210');
  await page.locator('button:not([disabled]):has-text("Pay")').first().click();

  // The rebuilt payment screen shows the confirmed total + the real UPI
  // deep-link ("Pay ₹N by UPI") and a 12-digit UTR reference field — there
  // is no separate "I've paid" tap anymore (the UPI app hand-off IS the
  // paid action; the reference number is how the shop verifies it).
  const upiButton = page.getByRole('button', { name: /Pay .* by UPI/ });
  await expect(upiButton).toBeVisible({ timeout: 15000 });
  // NOTE: do NOT click it in the test — it navigates to `upi://` (the OS
  // UPI app hand-off), which leaves a headless page unusable. The UTR
  // reference below is the verifiable path.

  const utrInput = page.getByLabel(/Enter UTR/i);
  await expect(utrInput).toBeVisible({ timeout: 5000 });

  // fewer than 12 digits → Submit disabled
  await utrInput.fill('12345');
  await expect(page.locator('button:not([disabled]):has-text("Submit")')).toHaveCount(0);

  // a full UTR submits and lands on the order tracking page (/o/<token>).
  // The UTR is unique per run: the server rejects a reference already
  // submitted for another order in the same shop (P0-1 requirement), so a
  // hardcoded UTR would fail every run after the first.
  const utr = String(Date.now() % 1_000_000_000_000).padStart(12, '0');
  await utrInput.fill(utr);
  await page.locator('button:not([disabled]):has-text("Submit")').first().click();
  await page.waitForURL(/\/o\//, { timeout: 20000 });
  // The order page shows the awaiting-payment state (UTR entry / status pill).
  await expect(page.getByText(/UTR|waiting|awaiting/i).first()).toBeVisible({ timeout: 20000 });
});

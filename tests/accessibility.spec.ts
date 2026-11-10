import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Phase 6.2 — Automated WCAG 2.2 AA accessibility scan.
 *
 * Uses `@axe-core/playwright` (a devDependency — justified: test-only,
 * never shipped to production bundles; axe-core is the industry-standard
 * a11y test harness recommended by the W3C and used byDeque and Microsoft).
 *
 * Scans the three pages a paying customer touches in the happy path:
 *   1. Homepage (`/`)                  — shop discovery + hero
 *   2. Shop detail (`/shops/quickprint`) — pricing reference + Start CTA
 *   3. Order page (`/orders/[id]`)     — upload + configure + checkout
 *
 * For each page:
 *   - navigate + wait for network idle
 *   - run AxeBuilder with the WCAG 2.x A + AA + 2.2 AA tag set
 *   - assert that `violations` is empty
 *
 * If violations are found, the test prints the full rule list + the
 * affected selectors so the failures are actionable — not silently green.
 *
 * Run: `PLAYWRIGHT_BASE_URL=http://localhost:3000 bunx playwright test tests/accessibility.spec.ts`
 */

const PROD = 'https://printshop-saas-three.vercel.app';

async function resolveTarget(): Promise<string> {
  if (process.env.PLAYWRIGHT_BASE_URL) return process.env.PLAYWRIGHT_BASE_URL;
  try {
    const res = await fetch('http://localhost:3000/', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok ? 'http://localhost:3000' : PROD;
  } catch {
    return PROD;
  }
}

let TARGET = PROD;

test.beforeAll(async () => {
  TARGET = await resolveTarget();
});

/** Common AxeBuilder config — WCAG 2.x A + AA, including 2.2 AA. */
function axe(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('#toast-region'); // Sonner/toast portal — managed outside React tree
}

/** Pretty-print violations for actionable failure output. */
function formatViolations(violations: import('axe-core').Result[]): string {
  if (violations.length === 0) return '  (no violations)';
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `      - ${n.target.join(' > ')}`)
        .slice(0, 5)
        .join('\n');
      return `  ✗ ${v.id} (${v.impact ?? 'minor'}) — ${v.help}\n     ${v.helpUrl}\n${nodes}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// 1. Homepage — hero + shop discovery + footer
// ---------------------------------------------------------------------------

test.describe('Accessibility — WCAG 2.2 AA', () => {
  test('homepage has no WCAG 2.2 AA violations', async ({ page }) => {
    await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    // Give the page a moment to settle (shop list fetch, etc.)
    await page.waitForTimeout(2000);
    const results = await axe(page).analyze();

    if (results.violations.length > 0) {
      console.error(
        `\nHomepage violations (${results.violations.length}):\n${formatViolations(results.violations)}\n`,
      );
    }
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('shop detail page has no WCAG 2.2 AA violations', async ({ page }) => {
    await page.goto(`${TARGET}/shops/quickprint`, { waitUntil: 'networkidle' });
    const results = await axe(page).analyze();

    if (results.violations.length > 0) {
      console.error(
        `\nShop page violations (${results.violations.length}):\n${formatViolations(results.violations)}\n`,
      );
    }
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('order page has no WCAG 2.2 AA violations', async ({ page }) => {
    // Walk the happy path: homepage → shop → Start order → land on /orders/[id].
    await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Pick the first shop card (role=button with visible shop name text).
    const firstCard = page.getByRole('button').filter({ hasText: /Print|Copy|Shop/i }).first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();
    await page.waitForURL(/\/shops\/[^/]+$/);

    // Click the primary CTA — "Start order" button.
    const startButton = page.getByRole('button', { name: /Start order/i }).first();
    await expect(startButton).toBeVisible();
    await startButton.click();

    // Wait for the redirect to /orders/[id].
    await page.waitForURL(/\/orders\/[^/]+/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    // Wait for the upload-card content to render — proves the page has
    // hydrated AND that the document <title> has been applied (Next.js
    // metadata effects run on the same React commit as the page content).
    // Without this wait the document-title rule can flake when the test
    // runs alongside other Playwright files (dev-server warmup pressure).
    await expect(page.getByText(/Step 1 · Upload your files/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveTitle(/PrintShop|Order/i);

    const results = await axe(page).analyze();

    if (results.violations.length > 0) {
      console.error(
        `\nOrder page violations (${results.violations.length}):\n${formatViolations(results.violations)}\n`,
      );
    }
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });
});

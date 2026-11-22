import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { Result as AxeResult, TagValue } from 'axe-core';

/**
 * axe-check — a thin wrapper around `@axe-core/playwright`'s AxeBuilder
 * that Playwright tests can call with one line to scan a page and fail
 * the test if there are any WCAG violations.
 *
 * Why this exists: the existing `tests/accessibility.spec.ts` repeats a
 * 20-line "build axe + analyze + pretty-print violations + expect empty"
 * block per page. This helper folds that into one call so future spec
 * files (per-route, per-flow) can add an axe scan with:
 *
 *   await runAxeCheck(page);
 *
 * The default tag set is WCAG 2.x A + AA including 2.2 AA — the project's
 * documented accessibility baseline (see docs/UX_AUDIT.md and
 * docs/ux/DESIGN_SYSTEM.md §accessibility).
 *
 * `axe-core` itself is a direct devDependency (declared in package.json)
 * so the `axe-core` type imports here resolve without relying on
 * `@axe-core/playwright`'s transitive hoisting — the types survive a
 * strict `bun install --frozen-lockfile` or a pnpm strict-node-layout CI.
 *
 * Violations are pretty-printed to stderr AND thrown as an AssertionError
 * so the Playwright reporter surfaces the actionable selector list when a
 * scan fails (not just "expected [] to equal []").
 */

/**
 * The default WCAG tag set the project tests against. Matches the tag set
 * in `tests/accessibility.spec.ts` so behaviour is identical between the
 * existing spec and any new specs that adopt this helper.
 */
export const DEFAULT_A11Y_TAGS: TagValue[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

/**
 * Selectors the customer-flow pages legitimately need to exclude:
 *
 *  - `#toast-region` — the Sonner/toast portal lives outside the React
 *    tree and axe finds false-positive `aria-allowed-attr` issues on its
 *    transient toast clones. Sonner manages its own ARIA; we trust it.
 *
 * Callers can pass additional excludes (or override this list entirely)
 * via {@link runAxeCheck}'s `exclude` option.
 */
export const DEFAULT_EXCLUDE: string[] = ['#toast-region'];

export interface RunAxeCheckOptions {
  /**
   * WCAG tag set to scan against. Defaults to {@link DEFAULT_A11Y_TAGS}
   * (WCAG 2.x A + AA including 2.2 AA).
   */
  tags?: TagValue[];
  /**
   * CSS selectors to exclude from the scan. Merged with
   * {@link DEFAULT_EXCLUDE} (callers don't need to repeat `#toast-region`).
   */
  exclude?: string[];
  /**
   * Optional extra rules to disable (by axe rule id, e.g. `color-contrast`
   * for pages where the design system hasn't finalised the palette).
   */
  disableRules?: string[];
  /**
   * When true, only fail the test on `serious` / `critical` impact
   * violations. Defaults to false (fail on any violation) — the project
   * targets zero violations as a baseline.
   */
  seriousOnly?: boolean;
  /**
   * Optional context label printed in the error message so a multi-page
   * scan's failures are easy to attribute (e.g. "shop landing (/s/foo)").
   */
  label?: string;
}

/**
 * Pretty-print axe violations into a readable multi-line string so the
 * Playwright failure output is actionable (rule id, impact, help URL,
 * and the affected selectors).
 */
export function formatViolations(violations: AxeResult[]): string {
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

/**
 * Run an axe scan on the given Playwright `Page` and throw if there are
 * violations. Returns the full axe results object so the caller can do
 * additional assertions (e.g. "exactly 2 best-practice violations, no
 * wcag violations").
 *
 * @example
 *   test('shop landing has no WCAG violations', async ({ page }) => {
 *     await page.goto('/s/quickprint');
 *     await runAxeCheck(page, { label: 'shop landing' });
 *   });
 */
export async function runAxeCheck(
  page: Page,
  options: RunAxeCheckOptions = {},
): Promise<import('axe-core').AxeResults> {
  const {
    tags = DEFAULT_A11Y_TAGS,
    exclude = [],
    disableRules = [],
    seriousOnly = false,
    label,
  } = options;

  const builder = new AxeBuilder({ page }).withTags(tags);

  // Merge the default excludes with any caller-supplied ones. We de-dupe
  // so passing `#toast-region` again is a no-op (not an error).
  const allExcludes = Array.from(new Set([...DEFAULT_EXCLUDE, ...exclude]));
  for (const selector of allExcludes) {
    builder.exclude(selector);
  }

  for (const ruleId of disableRules) {
    builder.disableRules([ruleId]);
  }

  const results = await builder.analyze();

  // Filter by impact if `seriousOnly` is set. axe reports `impact` as one
  // of "minor" | "moderate" | "serious" | "critical" (or undefined).
  let failing = results.violations;
  if (seriousOnly) {
    failing = failing.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
  }

  if (failing.length > 0) {
    const contextLabel = label ? ` (${label})` : '';
    const message =
      `\nAxe accessibility scan failed${contextLabel}: ${failing.length} violation(s)\n` +
      formatViolations(failing);
    // Print to stderr so it shows up in the Playwright reporter alongside
    // the test name; then throw so the test fails with an actionable diff.
    console.error(message);
    throw new Error(message);
  }

  return results;
}

export default runAxeCheck;

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the PrintShop customer redesign.
 *
 * Tests run on 3 mobile viewports (360x800, 390x844, 412x915)
 * with 4x CPU slowdown to simulate a mid-range phone.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './docs/redesign/evidence/playwright',
  fullyParallel: false, // Sequential — the dev server can't handle parallel
  retries: 1,
  workers: 1,
  // CI runners (2 cores) need more than Playwright's 30s default: the
  // upload→pay→track journey does init+chunk+complete + pipeline
  // processing end-to-end, and site-audit was red on every commit with
  // the 30s default while the same journey passes locally in under 30s.
  timeout: 120_000,
  reporter: [['html', { outputDir: './docs/redesign/evidence/playwright-report' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

  },
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'mobile-412',
      use: { viewport: { width: 412, height: 915 } },
    },
  ],
  webServer: {
    command: 'DATABASE_PROVIDER=memory bun run dev',
    port: 3000,
    timeout: 60_000,
    reuseExistingServer: true,
  },
});

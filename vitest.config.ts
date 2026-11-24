import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      // Bare package + subpath: @platform/core, @platform/core/errors, ...
      { find: /^@platform\/core$/, replacement: resolve(root, 'packages/core/src/index.ts') },
      { find: /^@platform\/core\/(.+)$/, replacement: resolve(root, 'packages/core/src/$1/index.ts') },
      { find: /^@platform\/adapters$/, replacement: resolve(root, 'packages/adapters/src/index.ts') },
      { find: /^@platform\/adapters\/(.+)$/, replacement: resolve(root, 'packages/adapters/src/$1/index.ts') },
      { find: /^@platform\/utils$/, replacement: resolve(root, 'packages/utils/src/index.ts') },
      { find: /^@platform\/utils\/(.+)$/, replacement: resolve(root, 'packages/utils/src/$1/index.ts') },
      // @/ → src/
      { find: /^@\/(.+)$/, replacement: resolve(root, 'src/$1') },
    ],
  },
  test: {
    include: ['packages/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // Real-PostgreSQL integration tier — these files require PROVISIONED
    // databases (printshop_test / printshop_app_test / printshop_clean,
    // see docs/testing/TEST_PLAN.md) and were written as an opt-in tier
    // (`bun run test:postgres`). They were never excluded from the default
    // run, so `bun run test:unit` failed on fresh clones where those
    // databases do not exist. Excluding them here is tiering, not
    // disabling: they run explicitly in the dedicated tier, and the
    // migration-integrity file's failure against the current chain is
    // tracked as BUG-LIST P1-14 (owner decision pending).
    exclude: [
      'src/lib/pricing/checkout-real-postgres.test.ts',
      'src/lib/pricing/app-webhook-integration.test.ts',
      'src/lib/pricing/app-checkout-concurrency.test.ts',
      'src/lib/pricing/migration-integrity.test.ts',
      'src/lib/pricing/webhook-postgres-fk.test.ts',
    ],
    environment: 'node',

  },
});

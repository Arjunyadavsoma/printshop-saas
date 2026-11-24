import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Real-PostgreSQL integration tier — run explicitly:
 *   bun run test:postgres
 *
 * Requires provisioned databases (printshop_test / printshop_app_test /
 * printshop_clean). Provisioning helper + known blocker (migration chain
 * cannot be replayed on a fresh DB, BUG-LIST P1-14) are documented in
 * docs/testing/TEST_PLAN.md.
 */
const root = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@platform\/core$/, replacement: resolve(root, 'packages/core/src/index.ts') },
      { find: /^@platform\/core\/(.+)$/, replacement: resolve(root, 'packages/core/src/$1/index.ts') },
      { find: /^@platform\/adapters$/, replacement: resolve(root, 'packages/adapters/src/index.ts') },
      { find: /^@platform\/adapters\/(.+)$/, replacement: resolve(root, 'packages/adapters/src/$1/index.ts') },
      { find: /^@platform\/utils$/, replacement: resolve(root, 'packages/utils/src/index.ts') },
      { find: /^@platform\/utils\/(.+)$/, replacement: resolve(root, 'packages/utils/src/$1/index.ts') },
      { find: /^@\/(.+)$/, replacement: resolve(root, 'src/$1') },
    ],
  },
  test: {
    include: [
      'src/lib/pricing/checkout-real-postgres.test.ts',
      'src/lib/pricing/app-webhook-integration.test.ts',
      'src/lib/pricing/app-checkout-concurrency.test.ts',
      'src/lib/pricing/migration-integrity.test.ts',
      'src/lib/pricing/webhook-postgres-fk.test.ts',
    ],
    environment: 'node',
  },
});

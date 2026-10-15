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
    include: ['packages/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});

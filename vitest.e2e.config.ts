import { defineConfig } from 'vitest/config';

// Browser tests: they drive the real app in headless Chromium (`npm run test:e2e`). They are kept out of `npm test`
// because they need a browser installed.
export default defineConfig({
  base: './',
  test: { include: ['tests/e2e/**/*.e2e.ts'], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});

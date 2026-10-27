import { defineConfig } from 'vitest/config';

// Browser tests: they drive the real app in headless Chromium (`npm run test:e2e`). They are kept out of `npm test`
// because they need a browser installed. The app is built once first and each file serves the build from its own server;
// `E2E_DEV=1 npm run test:e2e` serves the source from the dev server instead (slower to open, for debugging). Files run
// three at a time, each with its own server and browser.
export default defineConfig({
  base: './',
  test: {
    include: ['tests/e2e/**/*.e2e.ts'], globalSetup: ['tests/e2e/global-setup.ts'],
    testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: true, maxWorkers: 3,
  },
});

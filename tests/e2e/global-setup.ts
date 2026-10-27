import { build } from 'vite';
import { BUILT_DIR } from './built';

/** Build the app once before the browser tests run; every file serves this build (see start() in harness.ts). */
export default async function setup() {
  if (process.env.E2E_DEV) return;
  await build({ logLevel: 'silent', build: { outDir: BUILT_DIR, emptyOutDir: true } });
}

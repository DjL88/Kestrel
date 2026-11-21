import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Specs that import source modules by URL (`/src/...`) need Vite's dev server; the default config serves the built preview.
 * Run with `npm run test:e2e:dev`. Same projects, locale and timeouts as the default config.
 */
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: /verified-asset-.*\.spec\.ts/,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4275' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4275 --strictPort',
    url: 'http://127.0.0.1:4275',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});

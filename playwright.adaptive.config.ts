import { defineConfig, devices } from '@playwright/test';
import dev from './playwright.dev.config';

/**
 * InFlight final UAT cross-browser adaptive layout sweep.
 * Browser/viewport approximation ONLY: neither hinge segments nor physical
 * postures are emulated by Playwright. See UAT-FEATURE-FLAGS-AND-FOLDABLES.md.
 *
 * npx playwright test --config=playwright.adaptive.config.ts
 * Requires installed Chromium and WebKit Playwright browser binaries.
 */
export default defineConfig({
  ...dev,
  testMatch: /verified-asset-v2-adaptive\.spec\.ts/,
  testIgnore: undefined,
  projects: [
    {
      name: 'android-chromium-touch',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'unfolded-foldable-chromium',
      use: { browserName: 'chromium', viewport: { width: 1080, height: 720 },
        screen: { width: 1080, height: 720 }, deviceScaleFactor: 2,
        isMobile: true, hasTouch: true },
    },
    {
      name: 'iphone-webkit-touch',
      use: { browserName: 'webkit', viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 }, deviceScaleFactor: 3,
        isMobile: true, hasTouch: true },
    },
    {
      name: 'ipad-webkit-touch',
      use: { browserName: 'webkit', viewport: { width: 820, height: 1180 },
        screen: { width: 820, height: 1180 }, deviceScaleFactor: 2,
        isMobile: true, hasTouch: true },
    },
  ],
});

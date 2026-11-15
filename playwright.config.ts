import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: process.env.KESTREL_CHROME_PATH ? { executablePath: process.env.KESTREL_CHROME_PATH } : undefined,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    // The species model is a stand-in for tests (see tools/species/make_stand_in.py), served by the test itself.
    command: 'VITE_SHOW_ONLINE_HELPER=true VITE_SPECIES_MODEL_URL=/stand-in-species.onnx VITE_SPECIES_MODEL_SHA256=8e4dc3df3e5bfffc2f137f720775b6416b24325902f54929cd2e85f41c87f121 VITE_SPECIES_MODEL_BYTES=2278 npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
  },
});

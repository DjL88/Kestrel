import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Many steps wait up to 60s for on-device model work (subject finder, species, auto-cull). Playwright's 30s default
  // cut those waits short whenever several browsers ran at once, so tests failed on load rather than on behaviour.
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    // Tests read British English. A device in another language is offered it at first run (tests/language.spec.ts).
    locale: 'en-GB',
    launchOptions: process.env.KESTREL_CHROME_PATH ? { executablePath: process.env.KESTREL_CHROME_PATH } : undefined,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    // The species model is a stand-in for tests (see tools/species/make_stand_in.py), served by the test itself.
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    env: {
      ...process.env,
      VITE_SHOW_ONLINE_HELPER: 'true',
      VITE_SPECIES_MODEL_URL: '/stand-in-species.onnx',
      // The category gate's stand-in always "sees" a bird (tools/subject-router/make_stand_in_gate.py).
      VITE_GATE_MODEL_URL: '/stand-in-gate.onnx',
      VITE_GATE_MODEL_SHA256: '82f2f91400444fcc7889edcbd359d5d39aed0eb0698b643a679c2b74a9e5ae73',
      VITE_GATE_MODEL_BYTES: '2303',
      VITE_SPECIES_MODEL_SHA256: '8e4dc3df3e5bfffc2f137f720775b6416b24325902f54929cd2e85f41c87f121',
      VITE_SPECIES_MODEL_BYTES: '2278',
    },
    url: 'http://127.0.0.1:4173',
    // The command builds the app first. That alone takes 40-60s on the Windows laptop, so 60s (the default) is not enough.
    timeout: 180_000,
  },
});

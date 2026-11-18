import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execFileSync } from 'node:child_process';
import {defineConfig} from 'vite';
import {offlineBuild} from './offline-build.ts';

// Stamp the source revision into the shipped UI so an older Windows installer
// cannot appear identical to a newer Mac app merely because versions match.
const buildRevision = (() => {
  try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim(); }
  catch { return 'unavailable'; }
})();
const buildTimestamp = new Date().toISOString();

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), offlineBuild()],
    define: {
      'import.meta.env.VITE_KESTREL_BUILD_REVISION': JSON.stringify(buildRevision),
      'import.meta.env.VITE_KESTREL_BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
    },
    // Build the on-device runtime up front. Found only when first used, a dev server can re-bundle it mid-session and the
    // page then fails with "Failed to fetch dynamically imported module".
    optimizeDeps: { include: ['onnxruntime-web/wasm'] },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

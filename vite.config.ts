import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {offlineBuild} from './offline-build.ts';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), offlineBuild()],
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

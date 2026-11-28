import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {offlineBuild} from './offline-build.ts';
import { excludeRedModels } from './scripts/red-model-files.mjs';
import { buildInfoDefines, buildInfoPlugin, readGit, resolveProvenance } from './scripts/build-provenance.mjs';

export default defineConfig(({ command }) => {
  // Stamp the source revision into the shipped UI (Settings > Build information) and build-info.json, so an older Windows
  // installer cannot appear identical to a newer Mac app merely because versions match. A release build
  // (KESTREL_RELEASE=1) refuses to build from an unknown revision or a changed tree (G10). The dev server never refuses.
  const target = process.env.KESTREL_DESKTOP_BUILD === '1' || process.env.TAURI_ENV_PLATFORM ? 'desktop' : 'web';
  const provenance = resolveProvenance({
    env: command === 'build' ? process.env : { ...process.env, KESTREL_RELEASE: '0' },
    git: readGit(import.meta.dirname),
    target,
  });
  return {
    plugins: [react(), tailwindcss(), offlineBuild(), buildInfoPlugin(provenance), excludeRedModels()],
    define: buildInfoDefines(provenance),
    // Build the on-device runtime up front. Found only when first used, a dev server can re-bundle it mid-session and the
    // page then fails with "Failed to fetch dynamically imported module".
    optimizeDeps: { include: ['onnxruntime-web/wasm', 'onnxruntime-web/webgpu'] },
    // Workers are built as ES modules (they are all started with { type: 'module' }), so onnxruntime stays its own chunk
    // inside a worker too. With the default single-file worker, onnxruntime's thread helpers are started from the
    // worker's own file (import.meta.url), run the worker's code instead of the runtime's, and never answer: on the
    // cross-origin isolated desktop app (2-4 threads) every model in a worker then waited for ever at 0% CPU.
    worker: { format: 'es' },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
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

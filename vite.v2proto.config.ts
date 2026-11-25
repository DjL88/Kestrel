import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { buildInfoDefines, buildInfoPlugin, readGit, resolveProvenance } from './scripts/build-provenance.mjs';
import { parseControlPlaneUrl, parsePinnedKeys } from './src/core/licenceOnline.ts';

const onlineSettings = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_KESTREL_CONTROL_PLANE_URL',
  'VITE_KESTREL_GRANT_KEYS',
] as const;

// Unlike the public demo, this builds the REAL workspace. Every compiled
// /V2Proto/ asset must be served by the authenticated Cloud Run gateway.
export default defineConfig(({ mode }) => {
  const onlineRequired = process.env.V2PROTO_REQUIRE_ONLINE_CONFIG ?? 'false';
  if (onlineRequired !== 'true' && onlineRequired !== 'false') {
    throw new Error('V2PROTO_REQUIRE_ONLINE_CONFIG must be true or false.');
  }
  if (onlineRequired === 'true') {
    const env = loadEnv(mode, import.meta.dirname);
    const missing = onlineSettings.filter((name) => !env[name]?.trim());
    if (missing.length) throw new Error(`V2Proto online configuration missing: ${missing.join(', ')}`);
    if (!parseControlPlaneUrl(env.VITE_KESTREL_CONTROL_PLANE_URL)) {
      throw new Error('V2Proto needs a valid VITE_KESTREL_CONTROL_PLANE_URL.');
    }
    if (!Object.keys(parsePinnedKeys(env.VITE_KESTREL_GRANT_KEYS)).length) {
      throw new Error('V2Proto needs a valid public key in VITE_KESTREL_GRANT_KEYS.');
    }
  }

  // The image build has no .git, so Cloud Build passes KESTREL_BUILD_REVISION; KESTREL_RELEASE=1 fails closed (G10).
  const provenance = resolveProvenance({ env: process.env, git: readGit(import.meta.dirname), target: 'v2proto' });
  return {
    base: '/V2Proto/',
    plugins: [react(), tailwindcss(), buildInfoPlugin(provenance)],
    define: buildInfoDefines(provenance),
    build: {
      outDir: 'out/v2proto',
      emptyOutDir: true,
      rollupOptions: { input: { index: path.resolve(import.meta.dirname, 'v2-proto.html') } },
    },
  };
});

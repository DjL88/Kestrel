#!/usr/bin/env node
/**
 * Desktop builds always include offline species identification. The model is
 * downloaded at BUILD time, never via a hidden network request at app startup.
 * The existing fetch script fails closed on missing bytes or SHA-256 mismatch.
 */
import { spawnSync } from 'node:child_process';
import { assertReleaseBuildArgs, assertChildSucceeded, assertReleaseOnlineSettings, releaseModelSource } from './build-desktop-guard.mjs';
import { loadEnv } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
try {
assertReleaseBuildArgs(process.argv.slice(2));
// The same .env files Vite reads for the app, plus the environment, so the check sees what the build will see.
const buildEnv = { ...loadEnv('production', root, 'VITE_'), ...process.env };
if ((process.env.KESTREL_RELEASE ?? '1') !== '0') assertReleaseOnlineSettings(buildEnv);
const prepared = spawnSync(npm, ['run', 'model:species'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
assertChildSucceeded(prepared, 'Species model preparation');
const result = spawnSync(npx, ['tauri', 'build', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env,
    // Model packs and model updates come from the models bucket, checked against the pinned manifest key.
    ...releaseModelSource(buildEnv),
    VITE_SPECIES_MODEL_URL: '/models/bioclip-image-int8.onnx',
    VITE_SPECIES_MODEL_BUNDLED: 'true',
    // Belt and braces with the Tauri CLI's own TAURI_ENV_PLATFORM: a desktop build must never ship the caching web
    // worker (see offline-build.ts).
    KESTREL_DESKTOP_BUILD: '1',
    // Installers are releases: the web build refuses an unknown commit or a changed tree (scripts/build-provenance.mjs).
    // A developer's local test installer can opt out with KESTREL_RELEASE=0, and Settings > Build information then says so.
    KESTREL_RELEASE: process.env.KESTREL_RELEASE ?? '1',
  },
});
assertChildSucceeded(result, 'Tauri release build');
} catch (error) {
  console.error('DESKTOP RELEASE BLOCKED: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

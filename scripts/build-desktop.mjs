#!/usr/bin/env node
/**
 * Desktop builds always include offline species identification. The model is
 * downloaded at BUILD time, never via a hidden network request at app startup.
 * The existing fetch script fails closed on missing bytes or SHA-256 mismatch.
 */
import { spawnSync } from 'node:child_process';
import { assertReleaseBuildArgs, assertChildSucceeded } from './build-desktop-guard.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
try {
assertReleaseBuildArgs(process.argv.slice(2));
const prepared = spawnSync(npm, ['run', 'model:species'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
assertChildSucceeded(prepared, 'Species model preparation');
const result = spawnSync(npx, ['tauri', 'build', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env,
    VITE_SPECIES_MODEL_URL: '/models/bioclip-image-int8.onnx',
    VITE_SPECIES_MODEL_BUNDLED: 'true',
    // Belt and braces with the Tauri CLI's own TAURI_ENV_PLATFORM: a desktop build must never ship the caching web
    // worker (see offline-build.ts).
    KESTREL_DESKTOP_BUILD: '1',
  },
});
assertChildSucceeded(result, 'Tauri release build');
} catch (error) {
  console.error('DESKTOP RELEASE BLOCKED: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

#!/usr/bin/env node
/**
 * Desktop builds always include offline species identification. The model is
 * downloaded at BUILD time, never via a hidden network request at app startup.
 * The existing fetch script fails closed on missing bytes or SHA-256 mismatch.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const prepared = spawnSync(npm, ['run', 'model:species'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (prepared.status !== 0) process.exit(prepared.status || 1);
const result = spawnSync(npx, ['tauri', 'build', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env,
    VITE_SPECIES_MODEL_URL: '/models/bioclip-image-int8.onnx',
    VITE_SPECIES_MODEL_BUNDLED: 'true',
  },
});
process.exit(result.status || (result.error ? 1 : 0));

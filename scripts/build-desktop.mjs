#!/usr/bin/env node
/**
 * Desktop builds always include offline species identification. The model is
 * downloaded at BUILD time, never via a hidden network request at app startup.
 * The existing fetch script fails closed on missing bytes or SHA-256 mismatch.
 */
import { spawnSync } from 'node:child_process';
import { assertReleaseBuildArgs, assertChildSucceeded, assertReleaseOnlineSettings, assertSiteOriginAllowed, missingDriveSettings, releaseModelSource } from './build-desktop-guard.mjs';
import { loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { DEFAULT_HOST, completePacks, fetchList, readList } from './fetch-bundled-models.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
try {
assertReleaseBuildArgs(process.argv.slice(2));
// The same .env files Vite reads for the app, plus the environment, so the check sees what the build will see.
const buildEnv = { ...loadEnv('production', root, 'VITE_'), ...process.env };
if ((process.env.KESTREL_RELEASE ?? '1') !== '0') { assertReleaseOnlineSettings(buildEnv); assertSiteOriginAllowed(buildEnv, JSON.parse(readFileSync(new URL('../config/public-site.json', import.meta.url), 'utf8')).origin); }
const noDrives = missingDriveSettings(buildEnv);
if (noDrives.length) console.warn('Note: cloud drive sign-in will be off for: ' + noDrives.join(', ') + ' (add them to .env.local; see docs/CLOUD-CONNECTORS.md).');
const prepared = spawnSync(npm, ['run', 'model:species'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
assertChildSucceeded(prepared, 'Species model preparation');
// The optional packs this installer carries (models/desktop-packs.json): each file fetched and checked like the bundled
// models. A pack whose files cannot all be had is left out of this installer and stays a download in Settings.
const packList = readList(readFileSync(join(root, 'models', 'desktop-packs.json'), 'utf8'));
const packFetch = await fetchList(packList, join(root, 'public', 'models'));
const bundledPacks = completePacks(packList, packFetch.present);
for (const problem of packFetch.problems) console.warn('Note: ' + problem);
console.log(`Optional packs in this installer: ${bundledPacks.length ? bundledPacks.join(', ') : 'none'}. Any others stay downloads.`);
const result = spawnSync(npx, ['tauri', 'build', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env,
    // Model packs and model updates come from the models bucket, checked against the pinned manifest key.
    ...releaseModelSource(buildEnv),
    VITE_SPECIES_MODEL_URL: '/models/bioclip-image-int8.onnx',
    VITE_SPECIES_MODEL_BUNDLED: 'true',
    VITE_BUNDLED_PACKS: bundledPacks.join(','),
    // The packs it does not carry can still be downloaded, from the models bucket by checksum.
    VITE_MODEL_PACK_HOST: process.env.VITE_MODEL_PACK_HOST || DEFAULT_HOST,
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

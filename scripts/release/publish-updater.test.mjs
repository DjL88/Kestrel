import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_BUCKET, rewriteManifest, versionOf } from './publish-updater.mjs';

const manifest = () => ({
  version: '26.12.0', notes: 'Kestrel v26.12.0', pub_date: '2026-12-01T09:00:00Z',
  platforms: {
    'windows-x86_64': { signature: 'sig-w', url: 'https://github.com/DjL88/Kestrel/releases/download/v26.12.0/InFlight_26.12.0_x64-setup.exe' },
    'darwin-aarch64': { signature: 'sig-m', url: 'https://github.com/DjL88/Kestrel/releases/download/v26.12.0/InFlight.app.tar.gz' },
  },
});
const files = ['InFlight_26.12.0_x64-setup.exe', 'InFlight.app.tar.gz', 'InFlight_26.12.0_aarch64.dmg'];

test('every platform moves to the bucket and keeps its signature', () => {
  const out = rewriteManifest(manifest(), { version: '26.12.0', bucket: DEFAULT_BUCKET, files });
  assert.deepEqual(out.platforms['windows-x86_64'], { signature: 'sig-w', url: `https://storage.googleapis.com/${DEFAULT_BUCKET}/releases/26.12.0/InFlight_26.12.0_x64-setup.exe` });
  assert.equal(out.platforms['darwin-aarch64'].url, `https://storage.googleapis.com/${DEFAULT_BUCKET}/releases/26.12.0/InFlight.app.tar.gz`);
  assert.equal(out.pub_date, '2026-12-01T09:00:00Z');
});

test('a wrong version, a missing file or a missing signature stops the publish', () => {
  assert.throws(() => rewriteManifest(manifest(), { version: '26.12.1', bucket: DEFAULT_BUCKET, files }), /not 26.12.1/);
  assert.throws(() => rewriteManifest(manifest(), { version: '26.12.0', bucket: DEFAULT_BUCKET, files: files.slice(1) }), /not one of this release's files/);
  const unsigned = manifest(); unsigned.platforms['windows-x86_64'].signature = '';
  assert.throws(() => rewriteManifest(unsigned, { version: '26.12.0', bucket: DEFAULT_BUCKET, files }), /no signature/);
  assert.throws(() => rewriteManifest({ version: '26.12.0', platforms: {} }, { version: '26.12.0', bucket: DEFAULT_BUCKET, files }), /no platforms/);
  assert.throws(() => versionOf('v26.12.0-beta'), /stable release tag/);
});

test('installed apps read the manifest this script publishes', () => {
  const conf = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.deepEqual(conf.plugins.updater.endpoints, [`https://storage.googleapis.com/${DEFAULT_BUCKET}/updater/latest.json`]);
});

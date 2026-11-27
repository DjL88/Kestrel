import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertReleaseBuildArgs, assertChildSucceeded, assertReleaseOnlineSettings, assertSiteOriginAllowed, RELEASE_ONLINE_SETTINGS, RELEASE_MODEL_SOURCE, releaseModelSource } from './build-desktop-guard.mjs';

test('normal release arguments are accepted', () => {
  assert.doesNotThrow(() => assertReleaseBuildArgs([]));
  assert.doesNotThrow(() => assertReleaseBuildArgs(['--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis']));
});
test('debug and custom profile builds fail closed', () => {
  for (const args of [['--debug'], ['-d'], ['--debug=true'], ['--profile', 'dev'], ['--profile=custom']]) {
    assert.throws(() => assertReleaseBuildArgs(args), /release|profiles/);
  }
});
test('child success requires clean zero exit', () => {
  assert.doesNotThrow(() => assertChildSucceeded({status:0,signal:null,error:undefined}, 'build'));
  for (const result of [{status:1}, {status:null}, {status:null,signal:'SIGTERM'}, {status:null,error:new Error('ENOENT')}]) {
    assert.throws(() => assertChildSucceeded(result, 'build'), /build/);
  }
});

test('a release build needs every sign-in and licence setting, and names what is missing', () => {
  const full = Object.fromEntries(RELEASE_ONLINE_SETTINGS.map((name) => [name, 'value']));
  assert.doesNotThrow(() => assertReleaseOnlineSettings(full));
  assert.throws(() => assertReleaseOnlineSettings({ ...full, VITE_KESTREL_CONTROL_PLANE_URL: ' ' }), /VITE_KESTREL_CONTROL_PLANE_URL/);
  assert.throws(() => assertReleaseOnlineSettings({}), /VITE_FIREBASE_API_KEY.*VITE_KESTREL_GRANT_KEYS/);
});

test('release builds get the models bucket and pinned manifest key unless set already', () => {
  assert.deepEqual(releaseModelSource({}), RELEASE_MODEL_SOURCE);
  assert.deepEqual(releaseModelSource({ VITE_KESTREL_MODEL_BASE_URL: ' ' }), RELEASE_MODEL_SOURCE);
  assert.equal(releaseModelSource({ VITE_KESTREL_MODEL_KEYS: 'other=x' }).VITE_KESTREL_MODEL_KEYS, 'other=x');
  // The same values as the Terraform default key, the V2Proto image and .env.example.
  const key = RELEASE_MODEL_SOURCE.VITE_KESTREL_MODEL_KEYS;
  assert.ok(readFileSync(new URL('../infra/gcp/variables.tf', import.meta.url), 'utf8').includes(`default     = "${key}"`));
  const docker = readFileSync(new URL('../services/v2proto/Dockerfile', import.meta.url), 'utf8');
  for (const [name, value] of Object.entries(RELEASE_MODEL_SOURCE)) assert.ok(docker.includes(`ARG ${name}=${value}`), name);
});

test('missing cloud drive ids are listed as a note, never a refusal', async () => {
  const { missingDriveSettings } = await import('./build-desktop-guard.mjs');
  assert.deepEqual(missingDriveSettings({ VITE_DROPBOX_APP_KEY: 'abc', VITE_ONEDRIVE_CLIENT_ID: ' ' }),
    ['VITE_GOOGLE_DRIVE_CLIENT_ID', 'VITE_GOOGLE_DRIVE_CLIENT_SECRET', 'VITE_ONEDRIVE_CLIENT_ID']);
});

test('a release build refuses a site address other than the public origin, and says what to set', () => {
  assert.doesNotThrow(() => assertSiteOriginAllowed({ VITE_KESTREL_SITE_URL: 'https://inflight.studio/' }, 'https://inflight.studio'));
  assert.throws(() => assertSiteOriginAllowed({ VITE_KESTREL_SITE_URL: 'https://kestrel-hosting-kestrel.web.app' }, 'https://inflight.studio'), /VITE_KESTREL_SITE_URL=https:\/\/inflight\.studio/);
  assert.throws(() => assertSiteOriginAllowed({ VITE_KESTREL_SITE_URL: 'nonsense' }, 'https://inflight.studio'), /Not allowed/);
});

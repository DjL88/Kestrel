import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReleaseBuildArgs, assertChildSucceeded, assertReleaseOnlineSettings, RELEASE_ONLINE_SETTINGS } from './build-desktop-guard.mjs';

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

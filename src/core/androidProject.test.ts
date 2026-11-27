import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source checks for the Android project (no device or SDK needed). `npm test` runs from the repository root.
const manifest = readFileSync('src-tauri/gen/android/app/src/main/AndroidManifest.xml', 'utf8');
const cargoConfig = readFileSync('.cargo/config.toml', 'utf8');
const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf8');

test('the Android manifest does not claim to be an Android TV app', () => {
  // InFlight has no remote-control (D-pad) design; declaring a TV launcher puts it in Play's TV quality review.
  assert.doesNotMatch(manifest, /leanback/i);
  assert.doesNotMatch(manifest, /LEANBACK_LAUNCHER/);
});

test('every Android target links with 16 KB page alignment (Google Play requirement)', () => {
  for (const triple of ['aarch64-linux-android', 'x86_64-linux-android', 'armv7-linux-androideabi', 'i686-linux-android']) {
    const section = cargoConfig.split(/^\[target\./m).find((part) => part.startsWith(`${triple}]`));
    assert.ok(section, `${triple} is configured`);
    assert.match(section, /max-page-size=16384/);
  }
});

test('desktop-only native crates are never built for Android or iOS', () => {
  const mobileExcluded = cargoToml.split(/^\[/m).find((part) => part.startsWith('target.\'cfg(not(any(target_os = "android", target_os = "ios")))\'.dependencies]'));
  assert.ok(mobileExcluded, 'the desktop-only dependency table exists');
  for (const crate of ['kestrel-raw', 'kestrel-vision', 'kestrel-sftp', 'rawler', 'nusb']) {
    assert.match(mobileExcluded, new RegExp(`^${crate} =`, 'm'), `${crate} is desktop only`);
    const before = cargoToml.slice(0, cargoToml.indexOf('[target.'));
    assert.doesNotMatch(before, new RegExp(`^${crate} =`, 'm'), `${crate} is not a general dependency`);
  }
});

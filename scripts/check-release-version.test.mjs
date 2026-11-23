import test from 'node:test';
import assert from 'node:assert/strict';
import { cargoPackageVersion, checkRepositoryVersions, verifyVersions } from './check-release-version.mjs';
import { fileURLToPath } from 'node:url';

const same = { web: '0.1.0', tauri: '0.1.0', cargo: '0.1.0' };

test('desktop versions are in sync in the current repository', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(checkRepositoryVersions(root), /^\d+\.\d+\.\d+$/);
});

test('exact matching GitHub tag succeeds', () => {
  assert.equal(verifyVersions({ ...same, tag: 'v0.1.0' }), '0.1.0');
});

test('mismatched Tauri, Rust and release tag fail closed', () => {
  assert.throws(() => verifyVersions({ ...same, tauri: '0.1.1' }), /versions differ/);
  assert.throws(() => verifyVersions({ ...same, cargo: '0.2.0' }), /versions differ/);
  assert.throws(() => verifyVersions({ ...same, tag: 'v0.1.1' }), /does not match/);
});

test('invalid or missing versions cannot pass', () => {
  assert.throws(() => verifyVersions({ ...same, web: 'unknown' }), /invalid/);
  assert.throws(() => verifyVersions({ ...same, cargo: '' }), /invalid/);
});

test('Cargo parser reads package version rather than dependency versions', () => {
  const sample = '[package]\nname = "kestrel"\nversion = "2.3.4"\n\n[dependencies]\nplugin = { version = "99.1.0" }\n';
  assert.equal(cargoPackageVersion(sample), '2.3.4');
  assert.throws(() => cargoPackageVersion('[package]\nname = "kestrel"\n[dependencies]\nversion = "9.9.9"\n'), /missing/);
});


test('strict SemVer accepts valid prereleases and build metadata', () => {
  assert.equal(verifyVersions({ web: '2.3.4-rc.1+build.7', tauri: '2.3.4-rc.1+build.7', cargo: '2.3.4-rc.1+build.7', tag: 'v2.3.4-rc.1+build.7' }), '2.3.4-rc.1+build.7');
});

test('release gate rejects leading zeros and malformed prerelease identifiers', () => {
  for (const invalid of ['01.2.3', '1.02.3', '1.2.03', '1.2.3-01', '1.2.3-rc..1', '1.2.3-', '1.2.3+']) {
    assert.throws(() => verifyVersions({ web: invalid, tauri: invalid, cargo: invalid }), /invalid release version/, invalid);
  }
});

test('explicit empty or malformed release tags fail closed', () => {
  for (const tag of ['', '0.1.0', 'v0.1.0 ', 'v0.1.1']) {
    assert.throws(() => verifyVersions({ ...same, tag }), /does not match/, JSON.stringify(tag));
  }
  assert.equal(verifyVersions(same), '0.1.0');
});

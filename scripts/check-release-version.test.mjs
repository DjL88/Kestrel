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

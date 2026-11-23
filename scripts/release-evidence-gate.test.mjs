import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REQUIRED_GATES, checkReleaseEvidence, checkManifestFile } from './release-evidence-gate.mjs';

const sha = 'a'.repeat(40);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inflight-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'proof.txt'), 'UAT executed at a fixed SHA');
  const hash = createHash('sha256').update('UAT executed at a fixed SHA').digest('hex');
  const checks = Object.fromEntries(REQUIRED_GATES.map(k => [k, {
    status: 'PASS', releaseSha: sha, evidence: [{ path: 'proof.txt', sha256: hash }],
  }]));
  const manifest = { releaseSha: sha, unresolvedHoldPrs: [], releaseBlockers: [], checks };
  return { root, manifest, hash };
}

test('all gates PASS on exact SHA with matching evidence files', async t => {
  const { root, manifest } = await fixture(t);
  assert.deepEqual(await checkReleaseEvidence(manifest, root), []);
  await writeFile(path.join(root, 'release.json'), JSON.stringify(manifest));
  assert.deepEqual(await checkManifestFile(path.join(root, 'release.json')), []);
});

test('HOLD, not-run, missing evidence and SHA drift all block release', async t => {
  const { root, manifest } = await fixture(t);
  manifest.unresolvedHoldPrs.push(1078);
  manifest.releaseBlockers.push('actual Nikon UAT');
  manifest.checks.lint.status = 'NOT_RUN';
  manifest.checks.unit.releaseSha = 'b'.repeat(40);
  manifest.checks.build.evidence = [];
  const errors = await checkReleaseEvidence(manifest, root);
  for (const term of ['HOLD', 'Release blockers', 'lint: not PASS', 'unit: tested SHA', 'build: no evidence']) {
    assert.ok(errors.some(e => e.includes(term)), term);
  }
});

test('evidence modification, missing files and forged hashes are rejected', async t => {
  const { root, manifest } = await fixture(t);
  await writeFile(path.join(root, 'proof.txt'), 'changed');
  assert.ok((await checkReleaseEvidence(manifest, root)).some(e => e.includes('SHA-256 mismatch')));
  manifest.checks.lint.evidence = [{ path: 'missing.txt', sha256: 'f'.repeat(64) }];
  assert.ok((await checkReleaseEvidence(manifest, root)).some(e => e.includes('lint:')));
});

test('path traversal, symlinks and symlinked directories cannot present proof', async t => {
  const { root, manifest, hash } = await fixture(t);
  manifest.checks.lint.evidence = [{ path: '../escape.txt', sha256: hash }];
  assert.ok((await checkReleaseEvidence(manifest, root)).some(e => e.includes('Unsafe')));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'other-release-evidence-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'proof.txt'), 'UAT executed at a fixed SHA');
  await symlink(outside, path.join(root, 'linked'));
  manifest.checks.lint.evidence = [{ path: 'linked/proof.txt', sha256: hash }];
  assert.ok((await checkReleaseEvidence(manifest, root)).some(e => e.includes('outside manifest')));
});

test('missing a required release gate is a failure, not an implied pass', async t => {
  const { root, manifest } = await fixture(t);
  delete manifest.checks.originalShaBeforeAfter;
  assert.ok((await checkReleaseEvidence(manifest, root)).some(e => e.includes('originalShaBeforeAfter')));
});

test('invalid manifest and missing SHA are rejected', async t => {
  const { root, manifest } = await fixture(t);
  manifest.releaseSha = 'main';
  assert.ok((await checkReleaseEvidence(manifest, root)).some(e => e.includes('40-character')));
  await assert.rejects(checkManifestFile(path.join(root, 'missing.json')));
});

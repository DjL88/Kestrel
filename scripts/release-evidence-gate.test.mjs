import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REQUIRED_GATES, checkReleaseEvidence, checkManifestFile, checkReleaseCheckout, checkReleaseCommand } from './release-evidence-gate.mjs';

const sha = 'a'.repeat(40);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inflight-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proof = 'UAT executed at a fixed SHA';
  const hash = createHash('sha256').update(proof).digest('hex');
  const checks = Object.fromEntries(await Promise.all(REQUIRED_GATES.map(async k => {
    await writeFile(path.join(root, k + '.txt'), proof);
    return [k, {
      status: 'PASS', releaseSha: sha, evidence: [{ path: k + '.txt', sha256: hash }],
    }];
  })));
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
  await writeFile(path.join(root, 'lint.txt'), 'changed');
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

test('reusing one generic log for independent gates is refused', async t => {
  const { root, manifest } = await fixture(t);
  manifest.checks.unit.evidence = [...manifest.checks.lint.evidence];
  const errors = await checkReleaseEvidence(manifest, root);
  assert.ok(errors.some(e => e.includes('evidence path reused')));
});

test('release command accepts only an exact clean Git HEAD, not a declared SHA', async t => {
  const { root, manifest } = await fixture(t);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  git('init', '-q');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'user.name', 'Release Test');
  git('add', '.');
  git('commit', '-qm', 'known release source and UAT evidence');
  const actualHead = git('rev-parse', 'HEAD');
  manifest.releaseSha = actualHead;
  for (const check of Object.values(manifest.checks)) check.releaseSha = actualHead;
  await writeFile(path.join(root, 'release.json'), JSON.stringify(manifest));
  assert.deepEqual(await checkReleaseCommand(path.join(root, 'release.json'), root), []);
  assert.ok(checkReleaseCheckout('b'.repeat(40), root).some(e => e.includes('does not match')));
  await writeFile(path.join(root, 'lint.txt'), 'modified tracked source/evidence');
  assert.ok((await checkReleaseCommand(path.join(root, 'release.json'), root))
    .some(e => e.includes('modified tracked files')));
});

test('release checkout fails closed outside Git and with malformed SHA', () => {
  assert.ok(checkReleaseCheckout('bad-sha').some(e => e.includes('Invalid')));
  assert.ok(checkReleaseCheckout('a'.repeat(40), '/tmp').some(e => e.includes('Cannot verify')));
});

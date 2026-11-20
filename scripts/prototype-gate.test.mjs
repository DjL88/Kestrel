import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./prototype-gate.mjs', import.meta.url));
const sha = 'a'.repeat(40);
function run(args, env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'kestrel-prototype-gate-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  for (const name of ['git', 'npm', 'cargo']) {
    const body = name === 'git'
      ? '#!/bin/sh\ncase "$1" in\n  rev-parse) echo "' + sha + '";;\n  status) if [ "$KESTREL_TEST_DIRTY" = 1 ]; then echo " M file"; fi;;\n  branch) echo "test-branch";;\nesac\nexit 0\n'
      : '#!/bin/sh\nif [ "$KESTREL_TEST_FAIL_NPM" = 1 ] && [ "$1" = test ]; then exit 1; fi\nexit 0\n';
    const path = join(bin, name);
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  }
  const filename = join(home, 'evidence.json');
  try {
    const result = spawnSync(process.execPath, [script, ...args, '--out=' + filename], {
      cwd: home, encoding: 'utf8', env: { ...process.env, ...env, PATH: bin + ':' + process.env.PATH },
      timeout: 30_000,
    });
    const evidence = (() => { try { return JSON.parse(readFileSync(filename, 'utf8')); } catch { return null; } })();
    return { status: result.status, stderr: result.stderr, evidence };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test('refuses incorrect or duplicate CLI options before running checks', () => {
  for (const args of [['--expected-sha=xyz'], ['--e2e', '--e2e'], ['--secret=yes']]) {
    assert.equal(run(args).status, 2);
  }
});

test('strict gate never returns green when optional automated checks are omitted', { skip: process.platform === 'win32' }, () => {
  const result = run(['--strict', '--expected-sha=' + sha]);
  assert.equal(result.status, 2);
  assert.equal(result.evidence?.verdict, 'INCOMPLETE_AUTOMATED');
  assert.equal(result.evidence?.checks['browser-e2e'].status, 'NOT_RUN');
  assert.equal(result.evidence?.releaseReadiness, 'NOT_VERIFIED');
});

test('full automated pass is still not a photography or installed-app release approval', { skip: process.platform === 'win32' }, () => {
  const result = run(['--strict', '--e2e', '--raw', '--native', '--expected-sha=' + sha]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.evidence?.verdict, 'PASS_AUTOMATED_ONLY');
  assert.equal(result.evidence?.checks['native-raw-tests'].status, 'PASS');
  assert.equal(result.evidence?.checks['installed-cross-device-offline-journey'].status, 'NOT_RUN');
  assert.equal(result.evidence?.releaseReadiness, 'NOT_VERIFIED');
});

test('dirty SHA or failed tests cannot be reported as a pass', { skip: process.platform === 'win32' }, () => {
  const args = ['--strict', '--e2e', '--raw', '--native', '--expected-sha=' + sha];
  const dirty = run(args, { KESTREL_TEST_DIRTY: '1' });
  assert.equal(dirty.status, 1);
  assert.equal(dirty.evidence?.checks['clean-checkout'].status, 'FAIL');
  const failed = run(args, { KESTREL_TEST_FAIL_NPM: '1' });
  assert.equal(failed.status, 1);
  assert.equal(failed.evidence?.checks['core-and-provider-tests'].status, 'FAIL');
});

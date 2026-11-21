#!/usr/bin/env node
/**
 * Kestrel's local release-candidate evidence gate. No paid CI required.
 *
 * node scripts/prototype-gate.mjs --e2e --raw --native --strict --expected-sha=<40 hex>
 *
 * Automated checks cannot certify Nikon HE/HE*, image quality, installed apps,
 * NAS recovery, paid codec rights, or deployed secrets and licences.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const usage = 'Usage: node scripts/prototype-gate.mjs [--e2e] [--raw] [--native] [--strict] [--expected-sha=<40 hex>] [--out=path.json]';
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }
const flags = new Set(['--e2e', '--raw', '--native', '--strict']);
const keyed = new Set(['--out', '--expected-sha']);
const values = new Map();
let valid = true;
for (const arg of args) {
  if (flags.has(arg)) {
    if (values.has(arg)) valid = false;
    values.set(arg, true);
  } else {
    const split = arg.indexOf('=');
    const name = arg.slice(0, split);
    const value = arg.slice(split + 1);
    if (split < 0 || !keyed.has(name) || !value || values.has(name)) valid = false;
    else values.set(name, value);
  }
}
const expectedSha = values.get('--expected-sha');
if (expectedSha && !/^[a-f0-9]{40}$/i.test(expectedSha)) valid = false;
if (!valid) { console.error('Invalid or repeated option. ' + usage); process.exit(2); }
const output = resolve(values.get('--out') ?? '.kestrel-prototype-evidence/prototype-evidence.json');
const git = parameters => {
  const result = spawnSync('git', parameters, { encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : null;
};
const commit = git(['rev-parse', '--verify', 'HEAD']);
const status = git(['status', '--porcelain']);
const evidence = {
  schema: 2, recordedAt: new Date().toISOString(),
  commit, expectedSha: expectedSha ?? null, branch: git(['branch', '--show-current']),
  dirty: status === null ? null : status.length > 0,
  platform: process.platform, arch: process.arch, node: process.version,
  verdict: 'NOT_RUN', checks: {},
  limitations: [
    'Automated checks do not prove high-precision HE/HE* RAW colour, denoise or DxO/Adobe parity.',
    'Browser tests are not installed Windows/Mac/iOS/Android acceptance.',
    'Native photos, NAS storage, live services and signing/legal checks require separate real-world evidence.'
  ]
};
const mark = (name, status, reason) => { evidence.checks[name] = { status, reason }; };
mark('git-head', commit === null ? 'FAIL' : 'PASS', commit === null ? 'Git checkout unavailable' : 'Exact checkout SHA captured');
mark('clean-checkout', status === null ? 'NOT_RUN' : status.length ? 'FAIL' : 'PASS',
  status === null ? 'Git status unavailable' : status.length ? 'Uncommitted changes or untracked files are present' : 'Checkout clean');
mark('expected-sha', !expectedSha ? 'NOT_RUN' : commit?.toLowerCase() === expectedSha.toLowerCase() ? 'PASS' : 'FAIL',
  !expectedSha ? 'Use --expected-sha to pin the release candidate' : 'Comparison against owner-selected commit');

function run(name, command, commandArgs, timeoutMs = 300_000) {
  console.log('Checking ' + name + '...');
  const started = Date.now();
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, commandArgs, {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === 'win32' && command === 'npm',
    env: { ...process.env, CI: process.env.CI || '1' }
  });
  const tail = String(result.stderr ?? '') + '\n' + String(result.stdout ?? '');
  evidence.checks[name] = {
    status: result.status === 0 && !result.error ? 'PASS' : 'FAIL',
    exitCode: result.status, seconds: Math.round((Date.now() - started) / 100) / 10,
    error: result.error?.message ?? null,
    outputTail: tail.trim().split(/\r?\n/).slice(-25).join('\n').slice(-5000)
  };
  console.log(name + ': ' + evidence.checks[name].status);
  if (evidence.checks[name].status === 'FAIL') console.error(evidence.checks[name].outputTail);
}
run('typescript', 'npm', ['run', 'lint']);
run('core-and-provider-tests', 'npm', ['test']);
run('frontend-build', 'npm', ['run', 'build']);
if (values.has('--e2e')) run('browser-e2e', 'npm', ['run', 'test:e2e'], 600_000);
else mark('browser-e2e', 'NOT_RUN', 'Pass --e2e');
if (values.has('--raw')) run('raw-master-regression', 'npm', ['run', 'test:raw-master']);
else mark('raw-master-regression', 'NOT_RUN', 'Pass --raw');
if (values.has('--native')) {
  run('native-tauri-tests', 'cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml'], 1_200_000);
  run('native-raw-tests', 'cargo', ['test', '--manifest-path', 'crates/kestrel-raw/Cargo.toml'], 1_200_000);
} else {
  mark('native-tauri-tests', 'NOT_RUN', 'Pass --native on a machine with Rust installed');
  mark('native-raw-tests', 'NOT_RUN', 'Pass --native on a machine with Rust installed');
}
for (const name of [
  'nikon-he-star-icc-and-denoise-quality', 'mask-and-species-real-photo-accuracy',
  'installed-cross-device-offline-journey', 'nas-restart-recovery',
  'live-online-services-and-secrets', 'signing-licensing-and-codec-rights'
]) mark(name, 'NOT_RUN', 'Needs camera files, physical hardware, owner-authorised services or release review');
const mandatory = ['git-head', 'clean-checkout', 'expected-sha', 'typescript', 'core-and-provider-tests',
  'frontend-build', 'browser-e2e', 'raw-master-regression', 'native-tauri-tests', 'native-raw-tests'];
const failed = Object.values(evidence.checks).some(value => value.status === 'FAIL');
const unfinished = mandatory.some(name => evidence.checks[name].status !== 'PASS');
evidence.verdict = failed ? 'FAIL_AUTOMATED' : unfinished ? 'INCOMPLETE_AUTOMATED' : 'PASS_AUTOMATED_ONLY';
evidence.releaseReadiness = 'NOT_VERIFIED'; // Never implied by automated success alone.
evidence.requiredManualEvidence = Object.keys(evidence.checks).filter(name =>
  !mandatory.includes(name) && evidence.checks[name].status === 'NOT_RUN');
mkdirSync(dirname(output), { recursive: true });
const temp = output + '.tmp-' + process.pid;
writeFileSync(temp, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
renameSync(temp, output);
console.log('Automated verdict: ' + evidence.verdict + '. Evidence: ' + output);
console.log('Release readiness: NOT_VERIFIED until real camera, native device, NAS, services and legal gates pass.');
if (failed) process.exitCode = 1;
else if (values.has('--strict') && unfinished) process.exitCode = 2;

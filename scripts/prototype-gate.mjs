#!/usr/bin/env node
/**
 * Kestrel prototype gate. Runs locally without paid GitHub Actions.
 * PASS_AUTOMATED_ONLY is not a claim about photo fidelity or installed apps.
 *
 * node scripts/prototype-gate.mjs [--e2e] [--raw] [--out=path.json]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/prototype-gate.mjs [--e2e] [--raw] [--out=path.json]');
  process.exit(0);
}
const allowed = args.every(x => x === '--e2e' || x === '--raw' || (x.startsWith('--out=') && x.length > 6));
if (!allowed) { console.error('Unknown option. Use --help.'); process.exit(2); }
const output = resolve(args.find(x => x.startsWith('--out='))?.slice(6) ?? 'prototype-evidence.json');
const git = parameters => {
  const result = spawnSync('git', parameters, { encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : null;
};
const evidence = {
  schema: 1, recordedAt: new Date().toISOString(),
  commit: git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']),
  dirty: (git(['status', '--porcelain']) ?? 'git unavailable').length > 0,
  platform: process.platform, arch: process.arch, node: process.version,
  verdict: 'NOT_RUN', checks: {},
  limitations: [
    'Passing a build does not establish high-precision HE/HE* RAW quality or DxO/Adobe parity.',
    'Passing browser tests does not establish installed Windows/Mac/iOS/Android fidelity.',
    'Native photos, NAS storage and live cloud integrations require separate real-world evidence.'
  ]
};
function run(name, npmArgs, timeoutMs = 300_000) {
  console.log('Checking ' + name + '...');
  const started = Date.now();
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, CI: process.env.CI || '1' }
  });
  const tail = String(result.stderr ?? '') + '\n' + String(result.stdout ?? '');
  evidence.checks[name] = {
    status: result.status === 0 && !result.error ? 'PASS' : 'FAIL',
    exitCode: result.status,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    error: result.error?.message ?? null,
    outputTail: tail.trim().split(/\r?\n/).slice(-25).join('\n').slice(-5000)
  };
  console.log(name + ': ' + evidence.checks[name].status);
  if (evidence.checks[name].status === 'FAIL') console.error(evidence.checks[name].outputTail);
}
run('typescript', ['run', 'lint']);
run('core-and-provider-tests', ['test']);
run('frontend-build', ['run', 'build']);
if (args.includes('--e2e')) run('browser-e2e', ['run', 'test:e2e'], 600_000);
else evidence.checks['browser-e2e'] = { status: 'NOT_RUN', reason: 'Pass --e2e' };
if (args.includes('--raw')) run('raw-master-regression', ['run', 'test:raw-master']);
else evidence.checks['raw-master-regression'] = { status: 'NOT_RUN', reason: 'Pass --raw' };
for (const key of [
  'nikon-he-star-icc-and-denoise-quality',
  'mask-and-species-real-photo-accuracy',
  'installed-cross-device-offline-journey',
  'nas-restart-recovery',
  'live-online-services-and-secrets'
]) evidence.checks[key] = {
  status: 'NOT_RUN',
  reason: 'Requires actual photos, physical hardware or authorised live service configuration'
};
evidence.verdict = Object.values(evidence.checks).some(x => x.status === 'FAIL')
  ? 'FAIL_AUTOMATED' : 'PASS_AUTOMATED_ONLY';
mkdirSync(dirname(output), { recursive: true });
const temp = output + '.tmp-' + process.pid;
writeFileSync(temp, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
renameSync(temp, output);
console.log('Automated verdict: ' + evidence.verdict + '. Evidence: ' + output);
console.log('Real camera, device, NAS and live-service gates remain NOT_RUN.');
if (evidence.verdict === 'FAIL_AUTOMATED') process.exitCode = 1;

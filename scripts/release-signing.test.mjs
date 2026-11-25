import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSigning, releaseNote } from './release-signing.mjs';

const appleSign = { APPLE_CERTIFICATE: 'cert', APPLE_CERTIFICATE_PASSWORD: 'pw', APPLE_SIGNING_IDENTITY: 'Developer ID Application: X (TEAM)' };
const appleNotarise = { APPLE_ID: 'a@example.com', APPLE_PASSWORD: 'app-pw', APPLE_TEAM_ID: 'TEAM' };
const azure = {
  AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's', AZURE_TENANT_ID: 't',
  AZURE_SIGNING_ENDPOINT: 'https://weu.codesigning.azure.net', AZURE_SIGNING_ACCOUNT: 'acct', AZURE_SIGNING_PROFILE: 'prof',
};
const esigner = { ES_USERNAME: 'dave', ES_PASSWORD: 'pw', ES_CREDENTIAL_ID: 'cred', ES_TOTP_SECRET: 'totp' };
const pfx = { WINDOWS_CERTIFICATE: 'base64', WINDOWS_CERTIFICATE_PASSWORD: 'pw' };

test('no secrets: unsigned everywhere, no config, no errors, and the release note says so', () => {
  for (const os of ['macOS', 'Windows', 'Linux']) {
    const plan = planSigning({ os, env: {} });
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.exports, {});
    assert.equal(plan.config, null);
  }
  const note = releaseNote(planSigning({ os: 'Linux', env: {} }).release);
  assert.match(note, /macOS: unsigned\. Windows: unsigned\./);
  assert.match(note, /no update files/);
});

test('empty strings count as missing, as GitHub passes unset secrets as empty', () => {
  const plan = planSigning({ os: 'macOS', env: { APPLE_CERTIFICATE: '', TAURI_SIGNING_PRIVATE_KEY: '  ' } });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.config, null);
});

test('update key turns on updater artifacts on every platform, with an empty password allowed', () => {
  for (const os of ['macOS', 'Windows', 'Linux']) {
    const plan = planSigning({ os, env: { TAURI_SIGNING_PRIVATE_KEY: 'key' } });
    assert.equal(plan.config.bundle.createUpdaterArtifacts, true);
    assert.equal(plan.exports.TAURI_SIGNING_PRIVATE_KEY, 'key');
    assert.equal(plan.exports.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, '');
    assert.equal(plan.exports.VITE_KESTREL_UPDATER, '1');
  }
  assert.match(releaseNote(planSigning({ os: 'Linux', env: { TAURI_SIGNING_PRIVATE_KEY: 'key' } }).release), /app offers new versions/);
});

test('without the update key the app is built with its update check off', () => {
  for (const os of ['macOS', 'Windows', 'Linux']) {
    assert.equal(planSigning({ os, env: { ...appleSign, ...azure } }).exports.VITE_KESTREL_UPDATER, undefined);
  }
});

test('Apple: signing alone, then signing and notarisation; exported only on macOS', () => {
  const signed = planSigning({ os: 'macOS', env: appleSign });
  assert.deepEqual(signed.errors, []);
  assert.equal(signed.release.apple, 'signed, not notarised');
  assert.equal(signed.exports.APPLE_ID, undefined);
  const full = planSigning({ os: 'macOS', env: { ...appleSign, ...appleNotarise } });
  assert.equal(full.release.apple, 'signed and notarised');
  assert.equal(full.exports.APPLE_TEAM_ID, 'TEAM');
  const onWindows = planSigning({ os: 'Windows', env: { ...appleSign, ...appleNotarise } });
  assert.equal(onWindows.exports.APPLE_CERTIFICATE, undefined);
  assert.equal(onWindows.release.apple, 'signed and notarised');
});

test('partial secrets fail closed instead of building unsigned under a signed label', () => {
  assert.match(planSigning({ os: 'macOS', env: { APPLE_CERTIFICATE: 'c' } }).errors.join(), /APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY missing/);
  assert.match(planSigning({ os: 'macOS', env: appleNotarise }).errors.join(), /needs a signed app/);
  assert.match(planSigning({ os: 'Windows', env: { AZURE_CLIENT_ID: 'c' } }).errors.join(), /Azure Trusted Signing/);
  assert.match(planSigning({ os: 'Linux', env: { WINDOWS_CERTIFICATE: 'x' } }).errors.join(), /WINDOWS_CERTIFICATE_PASSWORD missing/);
});

test('Windows: Azure Trusted Signing sets a sign command; a certificate file sets the thumbprint', () => {
  const az = planSigning({ os: 'Windows', env: azure });
  assert.deepEqual(az.errors, []);
  assert.match(az.config.bundle.windows.signCommand, /^trusted-signing-cli -e https:\/\/weu\.codesigning\.azure\.net -a acct -c prof -d InFlight %1$/);
  assert.equal(az.exports.AZURE_CLIENT_SECRET, 's');
  const cert = planSigning({ os: 'Windows', env: { ...pfx, WINDOWS_CERTIFICATE_THUMBPRINT: 'ABC' } });
  assert.deepEqual(cert.errors, []);
  assert.equal(cert.config.bundle.windows.certificateThumbprint, 'ABC');
  assert.equal(cert.release.windows, 'signed (certificate)');
  assert.match(planSigning({ os: 'Windows', env: pfx }).errors.join(), /no thumbprint/);
  assert.match(planSigning({ os: 'Windows', env: { ...azure, ...pfx } }).errors.join(), /Keep one/);
  assert.equal(planSigning({ os: 'macOS', env: azure }).config, null);
});

test('Windows: SSL.com eSigner signs through the script, exports only its own secrets, and excludes other routes', () => {
  const plan = planSigning({ os: 'Windows', env: { ...esigner, GITHUB_WORKSPACE: 'D:\\a\\Kestrel\\Kestrel' } });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.release.windows, 'signed (SSL.com eSigner)');
  assert.equal(plan.config.bundle.windows.signCommand, 'pwsh -NoProfile -ExecutionPolicy Bypass -File D:/a/Kestrel/Kestrel/scripts/windows/esigner-sign.ps1 %1');
  assert.equal(plan.exports.ES_TOTP_SECRET, 'totp');
  assert.equal(plan.exports.AZURE_CLIENT_ID, undefined);
  assert.deepEqual(plan.here, ['no update files (TAURI_SIGNING_PRIVATE_KEY not set)', 'Windows installer signed (SSL.com eSigner)']);
  assert.match(planSigning({ os: 'Windows', env: { ES_USERNAME: 'dave' } }).errors.join(), /ES_PASSWORD, ES_CREDENTIAL_ID, ES_TOTP_SECRET missing/);
  const both = planSigning({ os: 'Windows', env: { ...esigner, ...azure } });
  assert.match(both.errors.join(), /Keep one/);
  assert.equal(both.config, null);
  assert.equal(planSigning({ os: 'macOS', env: esigner }).exports.ES_PASSWORD, undefined);
  assert.match(releaseNote(planSigning({ os: 'Linux', env: esigner }).release), /Windows: signed \(SSL\.com eSigner\)/);
});

test('command line writes env, outputs and a config file the way GitHub Actions reads them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-signing-'));
  const files = { GITHUB_ENV: join(dir, 'env'), GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'summary') };
  for (const file of Object.values(files)) writeFileSync(file, '');
  const script = fileURLToPath(new URL('./release-signing.mjs', import.meta.url));
  execFileSync(process.execPath, [script], {
    env: { ...files, RUNNER_OS: 'macOS', RUNNER_TEMP: dir, TAURI_SIGNING_PRIVATE_KEY: 'line1\nline2', ...appleSign },
    stdio: 'pipe',
  });
  const envFile = readFileSync(files.GITHUB_ENV, 'utf8');
  assert.match(envFile, /^TAURI_SIGNING_PRIVATE_KEY<<(KESTREL_[\w-]+)\nline1\nline2\n\1$/m);
  assert.match(envFile, /APPLE_SIGNING_IDENTITY<<KESTREL_[\w-]+\nDeveloper ID Application: X \(TEAM\)\n/);
  const out = readFileSync(files.GITHUB_OUTPUT, 'utf8');
  const configPath = out.match(/--config (\S+)/)[1];
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { bundle: { createUpdaterArtifacts: true } });
  assert.match(out, /macOS: signed, not notarised/);
  assert.match(readFileSync(files.GITHUB_STEP_SUMMARY, 'utf8'), /Signing on macOS/);
});

test('command line refuses partial secrets with a non-zero exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-signing-'));
  const script = fileURLToPath(new URL('./release-signing.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script], {
    env: { RUNNER_OS: 'Linux', RUNNER_TEMP: dir, GITHUB_ENV: join(dir, 'e'), GITHUB_OUTPUT: join(dir, 'o'), APPLE_ID: 'x' },
    stdio: 'pipe',
  }));
});

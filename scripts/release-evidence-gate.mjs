#!/usr/bin/env node
/**
 * InFlight release evidence gate. Standalone Node; no cloud, files modified or
 * native binaries invoked. Fail closed unless the same exact source SHA is
 * supported by recorded PASS evidence for every critical release journey.
 *
 * Usage: node scripts/release-evidence-gate.mjs path/to/evidence.json
 * This validates evidence provenance; it DOES NOT run or certify UAT itself.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_GATES = Object.freeze([
  'lint', 'unit', 'build', 'browserDesktop', 'browserPhone',
  'windowsInstaller', 'macosInstaller', 'originalShaBeforeAfter',
  'nasRelinkReopen', 'rawProvenance', 'cullDiversity', 'editUndoReopen',
  'exportPixelParity', 'privacyConsent', 'billingEntitlements', 'offlineNoUpload',
]);
const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const inside = (root, path) => path === root || (path.startsWith(root + sep));

function fail(message) { throw new Error(message); }

async function digestEvidence(root, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Invalid evidence entry');
  const { path, sha256 } = entry;
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') ||
      path.split('/').some(p => !p || p === '.' || p === '..') ||
      !SHA256.test(sha256 ?? '')) fail('Unsafe evidence path or hash');
  const location = resolve(root, path);
  if (!inside(root, location)) fail('Evidence escapes manifest directory');
  const stat = await lstat(location);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_EVIDENCE_BYTES) {
    fail('Evidence missing, empty, too large or not a regular file');
  }
  // Disallow symlinked parent directories too; a check on lstat(file) alone
  // would not stop an evidence file pointing outside the selected workspace.
  const parent = await realpath(dirname(location));
  if (!inside(root, parent)) fail('Evidence parent resolves outside manifest directory');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(location)) digest.update(chunk);
  if (digest.digest('hex') !== sha256.toLowerCase()) fail('Evidence SHA-256 mismatch');
}

export async function checkReleaseEvidence(manifest, root) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['Invalid manifest object'];
  const sha = manifest.releaseSha;
  if (typeof sha !== 'string' || !SHA40.test(sha)) errors.push('releaseSha must be an exact 40-character commit SHA');
  if (!Array.isArray(manifest.unresolvedHoldPrs)) errors.push('Missing unresolvedHoldPrs list');
  else if (manifest.unresolvedHoldPrs.length) errors.push('Unresolved HOLD PRs remain');
  if (!Array.isArray(manifest.releaseBlockers)) errors.push('Missing releaseBlockers list');
  else if (manifest.releaseBlockers.length) errors.push('Release blockers remain');
  const checks = manifest.checks;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    return [...errors, 'Missing checks object'];
  }
  const evidencePaths = new Set();
  for (const key of REQUIRED_GATES) {
    const check = checks[key];
    if (!check || typeof check !== 'object' || check.status !== 'PASS') {
      errors.push(`${key}: not PASS`); continue;
    }
    if (check.releaseSha !== sha) errors.push(`${key}: tested SHA differs from releaseSha`);
    if (!Array.isArray(check.evidence) || check.evidence.length === 0) {
      errors.push(`${key}: no evidence attached`); continue;
    }
    for (const item of check.evidence) {
      // Every release gate must have its own evidence. Reusing the same
      // generic log for every check cannot establish independent execution.
      if (typeof item?.path === 'string') {
        if (evidencePaths.has(item.path)) errors.push(`${key}: evidence path reused by another gate`);
        evidencePaths.add(item.path);
      }
      try { await digestEvidence(root, item); }
      catch (error) { errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  if (Object.keys(checks).some(k => !REQUIRED_GATES.includes(k))) {
    errors.push('Unexpected gate names in checks');
  }
  return errors;
}

export async function checkManifestFile(filename) {
  const manifestPath = resolve(filename);
  const stat = await lstat(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) fail('Invalid evidence manifest file');
  const base = await realpath(dirname(manifestPath));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  return checkReleaseEvidence(manifest, base);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: node scripts/release-evidence-gate.mjs <release-evidence.json>');
    process.exitCode = 2;
  } else {
    try {
      const errors = await checkManifestFile(filename);
      if (errors.length) {
        console.error(JSON.stringify({ ready: false, errors }, null, 2));
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify({ ready: true, evidenceValidated: REQUIRED_GATES.length }));
      }
    } catch (error) {
      console.error(JSON.stringify({ ready: false, errors: [String(error)] }));
      process.exitCode = 2;
    }
  }
}

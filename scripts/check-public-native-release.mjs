/**
 * Fail-closed public native release security gate.
 * Run: node scripts/check-public-native-release.mjs
 * This intentionally does NOT prevent local development or invited experimental builds.
 * Never weaken these checks to make a public installer appear ready.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export function inspectNativeRelease(config, capabilities) {
  const failures = [];
  const csp = config?.app?.security?.csp;
  if (!csp || (typeof csp === 'string' && !csp.trim())) {
    failures.push('Tauri CSP is unset: configure and test a restrictive production CSP.');
  }
  const permissions = capabilities?.permissions ?? [];
  const http = permissions.filter(p => typeof p === 'object' && p?.identifier === 'http:default');
  for (const p of http) for (const item of p.allow ?? []) {
    const url = String(item.url ?? '');
    if (/^https?:\/\/\*(?::\*)?\/?$/.test(url)) {
      failures.push('Unrestricted native HTTP destination: ' + url);
    }
    if (/^http:\/\//.test(url)) {
      failures.push('Plain HTTP native destination requires explicit LAN/NAS threat review: ' + url);
    }
  }
  const broadFs = ['fs:allow-read-file','fs:allow-write-file','fs:allow-remove','fs:allow-read-dir','fs:allow-open','fs:allow-mkdir'];
  for (const permission of permissions) {
    if (typeof permission === 'string' && broadFs.includes(permission)) {
      failures.push('Unscoped filesystem permission requires picker/path-scoped proof: ' + permission);
    }
  }
  if (config?.bundle?.createUpdaterArtifacts && !config?.plugins?.updater?.pubkey) {
    failures.push('Updater artefacts enabled without pinned updater key.');
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const capability = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8'));
  const failures = inspectNativeRelease(config, capability);
  if (failures.length) {
    console.error('PUBLIC NATIVE RELEASE BLOCKED (' + failures.length + ' security findings):');
    for (const finding of failures) console.error(' - ' + finding);
    console.error('Development and private testing are unaffected. Do not publish unrestricted installers.');
    process.exitCode = 1;
  } else {
    console.log('Native capability/CSP static gate passed. Signing, rights and installed-device validation remain separate mandatory gates.');
  }
}

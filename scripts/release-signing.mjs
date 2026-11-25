// Decides which release signing is switched on, from the repository secrets that exist.
// Each part (update key, Apple, Windows) turns on only when all of its secrets are present.
// A part with some secrets but not all fails the release, so a build is never called signed when it is not.
// Used by .github/workflows/release.yml; see docs/DESKTOP.md, "Signing and notarising checklist".
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const has = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

// Turns a group of secrets on only when every required one is present.
function group(env, label, required, errors) {
  const present = required.filter((name) => has(env, name));
  if (present.length === 0) return false;
  if (present.length < required.length) {
    const missing = required.filter((name) => !has(env, name));
    errors.push(`${label}: ${present.join(', ')} set but ${missing.join(', ')} missing. Add the missing secrets or remove the partial ones.`);
    return false;
  }
  return true;
}

/**
 * @param {{ os: 'macOS'|'Windows'|'Linux', env: Record<string, string|undefined> }} input
 * @returns {{ errors: string[], exports: Record<string,string>, config: object|null, release: { updater: boolean, apple: string, windows: string }, here: string[] }}
 */
export function planSigning({ os, env }) {
  const errors = [];
  const exports = {};
  const config = { bundle: {} };
  const here = [];

  // Updater signature: every platform. The key in docs/DESKTOP.md has no password, so the password may be empty.
  const updater = has(env, 'TAURI_SIGNING_PRIVATE_KEY');
  if (updater) {
    exports.TAURI_SIGNING_PRIVATE_KEY = env.TAURI_SIGNING_PRIVATE_KEY;
    exports.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '';
    config.bundle.createUpdaterArtifacts = true;
    // The app's update check is built in only when the release ships signed update files to check against.
    // Read by src/components/DesktopUpdate.tsx; local, PR and unsigned builds never check.
    exports.VITE_KESTREL_UPDATER = '1';
    here.push('update files signed with the Kestrel update key; the app checks for updates');
  } else {
    here.push('no update files (TAURI_SIGNING_PRIVATE_KEY not set)');
  }

  // Apple: code signing needs the certificate; notarisation needs the Apple ID trio as well.
  const appleSign = group(env, 'Apple signing', ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY'], errors);
  const appleNotarise = group(env, 'Apple notarisation', ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'], errors);
  if (appleNotarise && !appleSign) errors.push('Apple notarisation: the Apple ID secrets are set but the Developer ID certificate secrets are not. Notarisation needs a signed app.');
  const apple = appleSign && appleNotarise ? 'signed and notarised' : appleSign ? 'signed, not notarised' : 'unsigned';
  if (os === 'macOS') {
    if (appleSign) for (const name of ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY']) exports[name] = env[name];
    if (appleSign && appleNotarise) for (const name of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']) exports[name] = env[name];
    here.push(`macOS app ${apple}`);
  }

  // Windows: either Azure Trusted Signing (cloud, no certificate file) or an exportable .pfx certificate. Not both.
  const azure = group(env, 'Windows Azure Trusted Signing', ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE'], errors);
  const pfx = group(env, 'Windows certificate file', ['WINDOWS_CERTIFICATE', 'WINDOWS_CERTIFICATE_PASSWORD'], errors);
  if (azure && pfx) errors.push('Windows: both Azure Trusted Signing and a certificate file are configured. Keep one.');
  const windows = azure ? 'signed (Azure Trusted Signing)' : pfx ? 'signed (certificate)' : 'unsigned';
  if (os === 'Windows') {
    if (azure && !pfx) {
      for (const name of ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID']) exports[name] = env[name];
      // trusted-signing-cli is installed by the workflow; %1 is the file Tauri asks to sign.
      config.bundle.windows = {
        signCommand: `trusted-signing-cli -e ${env.AZURE_SIGNING_ENDPOINT} -a ${env.AZURE_SIGNING_ACCOUNT} -c ${env.AZURE_SIGNING_PROFILE} -d InFlight %1`,
      };
    } else if (pfx && !azure) {
      if (!has(env, 'WINDOWS_CERTIFICATE_THUMBPRINT')) {
        errors.push('Windows certificate file: the certificate was not imported, so there is no thumbprint to sign with.');
      } else {
        config.bundle.windows = {
          certificateThumbprint: env.WINDOWS_CERTIFICATE_THUMBPRINT,
          digestAlgorithm: 'sha256',
          timestampUrl: 'http://timestamp.digicert.com',
        };
      }
    }
    here.push(`Windows installer ${windows}`);
  }

  const used = updater || Object.keys(config.bundle).length > 0;
  return { errors, exports, config: used ? config : null, release: { updater, apple, windows }, here };
}

/** One line for the release page, the same from every runner, because each job sees every secret. */
export function releaseNote({ updater, apple, windows }) {
  return `Desktop builds. macOS: ${apple}. Windows: ${windows}. Linux: unsigned. In-app updates: ${updater ? 'signed update files included, and the app offers new versions (nothing installs without a tap)' : 'no update files'}.`;
}

function appendMultiline(file, name, value) {
  const delimiter = `KESTREL_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function main() {
  const os = process.env.RUNNER_OS;
  if (!['macOS', 'Windows', 'Linux'].includes(os)) throw new Error(`Unknown RUNNER_OS: ${os}`);
  const plan = planSigning({ os, env: process.env });
  for (const line of plan.here) console.log(`Signing: ${line}`);
  if (plan.errors.length) {
    for (const error of plan.errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  for (const [name, value] of Object.entries(plan.exports)) {
    appendMultiline(process.env.GITHUB_ENV, name, value);
  }
  let args = '';
  if (plan.config) {
    const path = join(process.env.RUNNER_TEMP, 'kestrel-signing.conf.json');
    writeFileSync(path, JSON.stringify(plan.config, null, 2));
    args = `--config ${path.replaceAll('\\', '/')}`;
  }
  appendMultiline(process.env.GITHUB_OUTPUT, 'args', args);
  appendMultiline(process.env.GITHUB_OUTPUT, 'release_note', releaseNote(plan.release));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Signing on ${os}\n${plan.here.map((line) => `- ${line}`).join('\n')}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

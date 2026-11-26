#!/usr/bin/env node
/**
 * Publish a finished desktop release to the downloads bucket, so installed apps update without reaching GitHub
 * (the repository is private, so its release files are not public).
 *
 *   node scripts/release/publish-updater.mjs --tag v26.12.0            # needs `gh` and `gcloud` signed in
 *   node scripts/release/publish-updater.mjs --tag v26.12.0 --dry-run  # shows what it would upload
 *
 * It downloads the release's files from GitHub (the release workflow's draft is fine), uploads each to
 * releases/<version>/ in the bucket, then rewrites the updater's latest.json so every platform points at the bucket
 * copy and uploads it to updater/latest.json last. Installed apps read that file (src-tauri/tauri.conf.json). The
 * signatures inside latest.json are kept as they are, so an update still has to match the app's public key.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BUCKET = 'kestrel-hosting-kestrel-downloads';
export const DEFAULT_REPO = 'DjL88/Kestrel';
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

export const publicUrl = (bucket, path) => `https://storage.googleapis.com/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** The version in a tag such as v26.12.0, or an error for anything that is not a plain stable version. */
export function versionOf(tag) {
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  if (!match) throw new Error(`"${tag}" is not a stable release tag such as v26.12.0.`);
  return match[1];
}

/**
 * The updater manifest with every platform's url moved to the bucket. Stops on a version that does not match the tag,
 * a platform with no signature, or a file that is not among the release's files.
 */
export function rewriteManifest(manifest, { version, bucket, files }) {
  if (!manifest || typeof manifest !== 'object' || !manifest.platforms || typeof manifest.platforms !== 'object') {
    throw new Error('latest.json has no platforms.');
  }
  if (versionOf(String(manifest.version)) !== version) throw new Error(`latest.json is for ${manifest.version}, not ${version}.`);
  const platforms = {};
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (!entry || typeof entry.signature !== 'string' || !entry.signature || typeof entry.url !== 'string') {
      throw new Error(`latest.json: ${platform} has no signature or url.`);
    }
    const file = decodeURIComponent(basename(new URL(entry.url).pathname));
    if (!SAFE_FILE.test(file) || !files.includes(file)) throw new Error(`latest.json: ${platform} points at ${file}, which is not one of this release's files.`);
    platforms[platform] = { ...entry, url: publicUrl(bucket, `releases/${version}/${file}`) };
  }
  if (Object.keys(platforms).length === 0) throw new Error('latest.json has no platforms.');
  return { ...manifest, platforms };
}

function args(argv) {
  const out = { repo: DEFAULT_REPO, bucket: DEFAULT_BUCKET, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tag') out.tag = argv[++i];
    else if (argv[i] === '--repo') out.repo = argv[++i];
    else if (argv[i] === '--bucket') out.bucket = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return out;
}

function run(command, list, dryRun) {
  console.log(`${dryRun ? '[dry run] ' : ''}${command} ${list.join(' ')}`);
  if (!dryRun) execFileSync(command, list, { stdio: 'inherit', shell: process.platform === 'win32' });
}

function main() {
  const { tag, repo, bucket, dryRun } = args(process.argv.slice(2));
  const version = versionOf(tag);
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-release-'));
  try {
    execFileSync('gh', ['release', 'download', tag, '-R', repo, '-D', dir], { stdio: 'inherit', shell: process.platform === 'win32' });
    const latestPath = join(dir, 'latest.json');
    if (!existsSync(latestPath)) throw new Error(`Release ${tag} has no latest.json. Build it with the release workflow first.`);
    const files = readdirSync(dir).filter((name) => name !== 'latest.json');
    const manifest = rewriteManifest(JSON.parse(readFileSync(latestPath, 'utf8')), { version, bucket, files });
    for (const file of files) run('gcloud', ['storage', 'cp', join(dir, file), `gs://${bucket}/releases/${version}/${file}`], dryRun);
    const out = join(dir, 'updater-latest.json');
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
    // Last, so an app never sees a manifest whose files are not there yet.
    run('gcloud', ['storage', 'cp', out, `gs://${bucket}/updater/latest.json`, '--cache-control=public, max-age=300'], dryRun);
    console.log(`${dryRun ? 'Would publish' : 'Published'} ${version} for ${Object.keys(manifest.platforms).join(', ')}: ${publicUrl(bucket, 'updater/latest.json')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}

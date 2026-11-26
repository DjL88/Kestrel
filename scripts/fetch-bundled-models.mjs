#!/usr/bin/env node
/**
 * Puts the large files the app ships with (the subject checker, the photo similarity model and the species lists) in
 * public/models/, so git does not have to hold them. Each one is listed in models/bundled-models.json with its size and
 * SHA-256, downloaded from the models bucket at <host>/<sha256>/<file>, and checked before it is kept. A file already
 * in place that matches is left alone, so this costs nothing after the first run and works offline from then on.
 *
 *     npm run models:fetch                 # once, or before a build (npm run build runs it)
 *     node scripts/fetch-bundled-models.mjs --optional        # warn instead of fail (npm run dev)
 *     node scripts/fetch-bundled-models.mjs --upload-commands # print the commands that publish them to the bucket
 *
 * The host is KESTREL_BUNDLED_MODEL_HOST, by default the public models bucket. A missing or wrong file fails the build:
 * the app never ships without a model it says it has.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_HOST = 'https://storage.googleapis.com/kestrel-hosting-kestrel-models/bundled';
export const BUCKET = 'gs://kestrel-hosting-kestrel-models/bundled';

export function readList(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.files)) throw new Error('bundled-models.json has no files list');
  for (const entry of parsed.files) {
    if (typeof entry.file !== 'string' || !/^[A-Za-z0-9._-]+$/.test(entry.file)) throw new Error(`bad file name: ${entry.file}`);
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) throw new Error(`bad SHA-256 for ${entry.file}`);
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) throw new Error(`bad size for ${entry.file}`);
  }
  return parsed.files;
}

export const sourceOf = (host, entry) => `${host.replace(/\/+$/, '')}/${entry.sha256}/${entry.file}`;

export function uploadCommands(entries, folder = 'public/models') {
  return entries.map((entry) => `gsutil -h "Cache-Control:public, max-age=31536000, immutable" cp -n ${folder}/${entry.file} ${BUCKET}/${entry.sha256}/${entry.file}`);
}

async function fileSha(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function inPlace(path, entry) {
  return existsSync(path) && statSync(path).size === entry.bytes && await fileSha(path) === entry.sha256;
}

async function download(url, target, entry) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${entry.file}: download failed (${response.status} ${response.statusText})`);
  const part = `${target}.part`;
  const hash = createHash('sha256');
  let received = 0;
  const out = createWriteStream(part);
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  } catch (error) {
    out.destroy();
    rmSync(part, { force: true });
    throw error;
  }
  if (received !== entry.bytes || hash.digest('hex') !== entry.sha256) {
    rmSync(part, { force: true });
    throw new Error(`${entry.file}: the download does not match its recorded size and SHA-256, so it was not kept`);
  }
  renameSync(part, target);
}

/**
 * Packs whose every file is in place, from the files that were fetched and checked. A pack missing any file is left
 * out, so an installer never says it carries a pack it does not have.
 */
export function completePacks(entries, present) {
  const packs = new Map();
  for (const entry of entries) {
    if (!entry.pack) continue;
    packs.set(entry.pack, (packs.get(entry.pack) ?? true) && present.has(entry.file));
  }
  return [...packs].filter(([, complete]) => complete).map(([pack]) => pack);
}

/** Fetch and check every file of a list into folder. Returns the files in place and the problems met. */
export async function fetchList(entries, folder, host = process.env.KESTREL_BUNDLED_MODEL_HOST || DEFAULT_HOST) {
  mkdirSync(folder, { recursive: true });
  const problems = [];
  const present = new Set();
  for (const entry of entries) {
    const target = join(folder, entry.file);
    if (await inPlace(target, entry)) { present.add(entry.file); continue; }
    const url = sourceOf(host, entry);
    console.log(`Downloading ${entry.file} (${Math.round(entry.bytes / 1e6)} MB) from ${url}`);
    try { await download(url, target, entry); present.add(entry.file); } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  return { present, problems };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const entries = readList(readFileSync(join(root, 'models', 'bundled-models.json'), 'utf8'));
  if (args.has('--upload-commands')) { console.log(uploadCommands(entries).join('\n')); return; }
  const { problems } = await fetchList(entries, join(root, 'public', 'models'));
  if (!problems.length) { console.log(`Bundled models: all ${entries.length} in place and matching their checksums.`); return; }
  for (const problem of problems) console.error(problem);
  if (args.has('--optional')) { console.warn('Some bundled models are missing; the features that need them will say so.'); return; }
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

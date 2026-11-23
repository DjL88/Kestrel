#!/usr/bin/env node
/**
 * InFlight UAT: independent before/after integrity proof for originals.
 * Read-only source folder; SHA-256 is streamed, not held in memory. Nothing is
 * uploaded or changed in the originals. Run once before the shoot and again
 * after import/edit/export/relaunch or reconnecting an external drive.
 *
 * node scripts/uat-original-integrity.mjs baseline /photos /outside/originals.json
 * node scripts/uat-original-integrity.mjs verify   /photos /outside/originals.json
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHOTO_EXT = new Set([
  '.nef', '.nrw', '.jpg', '.jpeg', '.png', '.heif', '.heic', '.tif', '.tiff',
  '.dng', '.cr2', '.cr3', '.arw', '.raf', '.orf', '.rw2', '.pef', '.srw',
]);
const HEX_SHA = /^[0-9a-f]{64}$/;
const isInside = (root, filename) => filename === root || filename.startsWith(root + path.sep);

export async function listOriginals(root) {
  const entries = [];
  async function walk(dir, relative = '') {
    const items = await readdir(dir, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      const name = path.join(relative, item.name);
      const location = path.join(dir, item.name);
      if (item.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link in source folder: ${name}`);
      }
      if (item.isDirectory()) await walk(location, name);
      else if (item.isFile() && PHOTO_EXT.has(path.extname(item.name).toLowerCase())) {
        entries.push({ relativePath: name.split(path.sep).join('/'), absolutePath: location });
      }
    }
  }
  await walk(root);
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function hashOriginal(filename) {
  const before = await lstat(filename);
  if (!before.isFile()) throw new Error(`Not a regular original: ${filename}`);
  const sha = createHash('sha256');
  for await (const chunk of createReadStream(filename, { highWaterMark: 1024 * 1024 })) sha.update(chunk);
  const after = await lstat(filename);
  if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino || before.dev !== after.dev) {
    throw new Error(`Original changed while reading: ${filename}`);
  }
  return { bytes: after.size, sha256: sha.digest('hex') };
}

export async function scanOriginals(root) {
  const files = [];
  for (const entry of await listOriginals(root)) {
    files.push({ path: entry.relativePath, ...await hashOriginal(entry.absolutePath) });
  }
  return files;
}

function verifyManifestShape(data) {
  if (!data || data.schema !== 1 || !Array.isArray(data.files)) throw new Error('Invalid manifest schema.');
  const known = new Set();
  for (const file of data.files) {
    if (!file || typeof file.path !== 'string' || file.path.length === 0 ||
        file.path.startsWith('/') || file.path.includes('\\') ||
        file.path.split('/').some((component) => !component || component === '.' || component === '..') ||
        known.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        !HEX_SHA.test(file.sha256)) {
      throw new Error('Invalid or duplicate manifest entry.');
    }
    known.add(file.path);
  }
  return data.files;
}

/** Never follow manifest paths: instead enumerate current real files and compare relative names. */
export function compareOriginals(expected, actual) {
  const earlier = new Map(verifyManifestShape({ schema: 1, files: expected }).map((f) => [f.path, f]));
  const current = new Map(actual.map((f) => [f.path, f]));
  const missing = [...earlier.keys()].filter((name) => !current.has(name)).sort();
  const added = [...current.keys()].filter((name) => !earlier.has(name)).sort();
  const changed = [...earlier.entries()]
    .filter(([name, value]) => current.has(name) &&
      (current.get(name).sha256 !== value.sha256 || current.get(name).bytes !== value.bytes))
    .map(([name]) => name).sort();
  return { ok: !missing.length && !added.length && !changed.length,
    checked: earlier.size, missing, changed, added };
}

export async function runIntegrityCommand(command, sourceFolder, manifestFile) {
  if (command !== 'baseline' && command !== 'verify') throw new Error('Choose baseline or verify.');
  const root = path.resolve(sourceFolder);
  const manifestPath = path.resolve(manifestFile);
  const source = await lstat(root);
  if (!source.isDirectory()) throw new Error('Source must be an existing directory.');
  if (isInside(root, manifestPath)) {
    throw new Error('Put the integrity manifest OUTSIDE the originals folder.');
  }
  if (command === 'baseline') {
    const files = await scanOriginals(root);
    if (!files.length) throw new Error('No recognised photograph originals found; baseline not created.');
    // Exclusive creation prevents inadvertently replacing the BEFORE evidence.
    await writeFile(manifestPath, JSON.stringify({ schema: 1, createdAt: new Date().toISOString(),
      algorithm: 'sha256', files }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { ok: true, checked: files.length, missing: [], changed: [], added: [] };
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const originalFiles = verifyManifestShape(manifest);
  if (manifest.algorithm !== 'sha256') throw new Error('Manifest must use SHA-256.');
  return compareOriginals(originalFiles, await scanOriginals(root));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, manifest] = process.argv.slice(2);
  if (!source || !manifest || !['baseline', 'verify'].includes(command)) {
    console.error('Usage: node scripts/uat-original-sha.mjs baseline|verify <originals-folder> <manifest-outside-folder.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = await runIntegrityCommand(command, source, manifest);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      console.error(`Original integrity check failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  }
}

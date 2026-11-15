import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

/** Read just the [package] version, not dependency versions in Cargo.toml. */
export function cargoPackageVersion(toml) {
  const section = /^\[package\]\s*$([\s\S]*?)(?=^\[|\s*$)/m.exec(toml)?.[1];
  const version = section && /^version\s*=\s*"([^"]+)"\s*(?:#.*)?$/m.exec(section)?.[1];
  if (!version) throw new Error('Cargo.toml [package] version is missing.');
  return version;
}

/** Validates the three version sources and optional GitHub release tag. */
export function verifyVersions({ web, tauri, cargo, tag }) {
  const versions = [['package.json', web], ['src-tauri/tauri.conf.json', tauri], ['src-tauri/Cargo.toml', cargo]];
  for (const [name, version] of versions) {
    if (typeof version !== 'string' || !SEMVER.test(version)) throw new Error(`${name} has an invalid release version: ${String(version)}`);
  }
  if (new Set(versions.map((entry) => entry[1])).size !== 1) {
    throw new Error(`Desktop release versions differ: ${versions.map(([name, value]) => `${name}=${value}`).join(', ')}`);
  }
  if (tag && tag !== `v${web}`) {
    throw new Error(`Git release tag ${tag} does not match application v${web}.`);
  }
  return web;
}

export function checkRepositoryVersions(root, tag) {
  const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const cargo = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8');
  return verifyVersions({
    web: json('package.json').version,
    tauri: json('src-tauri/tauri.conf.json').version,
    cargo: cargoPackageVersion(cargo),
    tag,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = checkRepositoryVersions(resolve(fileURLToPath(new URL('..', import.meta.url))), process.env.KESTREL_RELEASE_TAG || undefined);
    process.stdout.write(`Kestrel versions match: v${version}\n`);
  } catch (error) {
    process.stderr.write(`Kestrel release blocked: ${error.message}\n`);
    process.exitCode = 1;
  }
}

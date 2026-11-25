#!/usr/bin/env node
/**
 * Release parity check (G10): the desktop build, the hosted web app and the model packs must all come from the same
 * clean commit, and (with --expect) that commit must be the one being released. Fails closed: a missing, unreadable,
 * dirty or unknown record fails the check, never passes it.
 *
 *   node scripts/check-release-parity.mjs --desktop=dist/build-info.json \
 *     --web=https://<site>/V2Proto/build-info.json --models=out/models/manifest/build-info.json [--expect=<sha|HEAD>]
 *
 * Each record is a build-info.json written by scripts/build-provenance.mjs (or, for model packs, by
 * scripts/release/sign-data-manifest.ts). Any name=source pair is accepted (--mac=..., --windows=...); at least two
 * sources are required, since one record cannot be compared with anything.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseProblems } from './build-provenance.mjs';

/**
 * Compare build records. Returns a list of plain-English problems; empty means every record is clean and identical.
 * @param {Array<{ name: string, info: unknown, error?: string }>} records
 * @param {string | null} expect full SHA every record must carry, or null
 */
export function compareRecords(records, expect = null) {
  const problems = [];
  if (records.length < 2) problems.push('at least two builds are needed to compare (for example --desktop and --web)');
  const revisions = new Map();
  for (const { name, info, error } of records) {
    if (error) { problems.push(`${name}: ${error}`); continue; }
    for (const problem of releaseProblems(info)) problems.push(`${name}: ${problem}`);
    const revision = info && typeof info === 'object' ? info.revision : null;
    if (typeof revision === 'string') revisions.set(name, revision);
  }
  const distinct = new Set(revisions.values());
  if (distinct.size > 1) {
    problems.push('builds come from different commits: ' + [...revisions].map(([n, r]) => `${n}=${r.slice(0, 12)}`).join(', '));
  }
  if (expect) {
    for (const [name, revision] of revisions) {
      if (revision !== expect) problems.push(`${name} is ${revision.slice(0, 12)}, not the release commit ${expect.slice(0, 12)}`);
    }
  }
  return problems;
}

/** Parse `--name=source` arguments. */
export function parseArgs(argv) {
  const sources = [];
  let expect = null;
  for (const arg of argv) {
    const match = /^--([a-z][a-z0-9-]*)=(.+)$/.exec(arg);
    if (!match) throw new Error('Unknown argument: ' + arg + ' (use --name=path-or-url)');
    if (match[1] === 'expect') expect = match[2];
    else if (sources.some((s) => s.name === match[1])) throw new Error('Repeated source: --' + match[1]);
    else sources.push({ name: match[1], source: match[2] });
  }
  return { sources, expect };
}

async function load(source) {
  try {
    if (/^https?:\/\//.test(source)) {
      // A stale CDN copy must not pass for the live build.
      const response = await fetch(source, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) return { error: `could not be read (HTTP ${response.status}) from ${source}` };
      return { info: await response.json() };
    }
    return { info: JSON.parse(await readFile(source, 'utf8')) };
  } catch (error) {
    return { error: `could not be read from ${source} (${error instanceof Error ? error.message : String(error)})` };
  }
}

function resolveExpect(expect) {
  if (!expect) return null;
  if (/^[0-9a-f]{40}$/i.test(expect)) return expect.toLowerCase();
  return execFileSync('git', ['rev-parse', '--verify', expect + '^{commit}'], { encoding: 'utf8' }).trim();
}

async function main() {
  const { sources, expect } = parseArgs(process.argv.slice(2));
  const records = await Promise.all(sources.map(async ({ name, source }) => ({ name, ...(await load(source)) })));
  const problems = compareRecords(records, resolveExpect(expect));
  for (const { name, info } of records) {
    if (info && typeof info === 'object') console.log(`${name}: ${info.revision ?? 'unknown'}${info.dirty ? ' (changed tree)' : ''}, built ${info.builtAt ?? 'at an unknown time'}`);
  }
  if (problems.length) {
    console.error('RELEASE PARITY FAILED:\n- ' + problems.join('\n- '));
    process.exitCode = 1;
  } else {
    console.log('RELEASE PARITY PASSED: every build is the same clean commit.');
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => { console.error('RELEASE PARITY FAILED: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
}

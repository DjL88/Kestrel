/**
 * Dry run of a launch publish: website, downloads and model packs. It changes nothing and opens no connection: no
 * gcloud, no firebase, no upload, no signing key. It reads this checkout, works out exactly what publish-gcp.ps1 and
 * sign-data-manifest.ts would put where (src/core/publishPlan.ts), and says what is wrong first.
 *
 *   npm run release:dry-run -- [--project kestrel-hosting] [--version 26.11.4 --installers <folder or file,...>]
 *                              [--model-version 2026.11.26] [--json out/publish-plan.json]
 *
 * Run `git fetch origin main` first so "is this commit on main" is answered against the current main.
 * Exit code 1 when there is a problem to fix before publishing, 0 when the plan is clean.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadEnv } from 'vite';
import { planPublish, type InstallerFile } from '../../src/core/publishPlan.ts';

const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const json = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const git = (...args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};

const project = arg('project') ?? 'kestrel-hosting';
const version = arg('version');
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
const modelVersion = arg('model-version') ?? today;

function installerFiles(spec: string | undefined): InstallerFile[] {
  if (!spec) return [];
  const paths = spec.split(',').flatMap((p) => {
    const full = resolve(p);
    return existsSync(full) && statSync(full).isDirectory() ? readdirSync(full).map((n) => join(full, n)).filter((f) => statSync(f).isFile()) : [full];
  });
  return paths.map((full) => {
    if (!existsSync(full)) throw new Error(`No such installer: ${full}`);
    return { name: basename(full), bytes: statSync(full).size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') };
  });
}

const sha = git('rev-parse', 'HEAD');
const commit = sha ? {
  sha,
  onMain: git('merge-base', '--is-ancestor', sha, 'origin/main') !== null,
  dirty: (git('status', '--porcelain') ?? '').length > 0,
} : null;

const plan = planPublish({
  project,
  publicSite: json('config/public-site.json'),
  firebase: json('firebase.json'),
  version,
  installers: installerFiles(arg('installers')),
  modelVersion,
  visionModels: json('scripts/models/manifest.json').models,
  buildEnv: { ...loadEnv('production', root, 'VITE_'), ...process.env },
  commit,
});

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MiB`;
const out: string[] = [];
const line = (s = '') => out.push(s);
line(`InFlight publish dry run: project ${project}, commit ${commit?.sha.slice(0, 12) ?? 'unknown'}. Nothing was uploaded or deployed.`);
line();
line(`Hosting (Firebase site ${plan.buckets.hostingSite})`);
for (const c of plan.hosting) line(`  ${c.ok ? 'OK  ' : 'FIX '} ${c.what}`);
line();
line(`Downloads (gs://${plan.buckets.downloads})`);
if (!plan.downloads.objects.length) line('  nothing to upload');
for (const o of plan.downloads.objects) line(`  ${o.path}${o.bytes ? `  ${mb(o.bytes)}  sha256 ${o.sha256}` : ''}  [${o.cacheControl}]`);
line();
line(`Model packs (gs://${plan.buckets.models}, model version ${modelVersion})`);
for (const r of plan.modelPacks) line(`  ${r.status === 'ready' ? 'OK  ' : r.status === 'held' ? 'HELD' : 'BIG '} ${r.name} [${r.role}, ${r.tier}]  ${mb(r.bytes)}  sha256 ${r.sha256}\n         ${r.url}`);
line();
line('Local vision models (fetched from their authors at a pinned revision, not mirrored)');
for (const v of plan.visionModels) line(`  ${v.id}: ${v.repo}@${v.revision.slice(0, 12)}, ${v.license}, ${v.pinnedFiles} pinned files, int8 ${mb(v.int8Bytes)}, q4 ${mb(v.q4Bytes)}`);
line();
line('Release build settings');
for (const c of plan.buildSettings) line(`  ${c.ok ? 'OK  ' : 'FIX '} ${c.what}`);
line();
if (plan.notes.length) { line('Notes'); for (const n of plan.notes) line(`  - ${n}`); line(); }
line('Commands publish would run, in order (NOT run here)');
for (const c of plan.commands) line(`  ${c}`);
line();
line('Needs the owner to approve');
plan.approvals.forEach((a, i) => line(`  ${i + 1}. ${a}`));
line();
line(plan.problems.length ? `PROBLEMS (${plan.problems.length}), fix before publishing:` : 'No problems found in the plan.');
for (const p of plan.problems) line(`  - ${p}`);
console.log(out.join('\n'));

const jsonOut = arg('json');
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(resolve(jsonOut), `${JSON.stringify({ project, commit, modelVersion, ...plan }, null, 2)}\n`);
}
process.exitCode = plan.problems.length ? 1 : 0;

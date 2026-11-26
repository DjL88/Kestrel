/**
 * The launch publish, worked out on paper. Pure: it reads what it is given and decides exactly which objects would go
 * where, with which digests, and what is wrong first. scripts/release/publish-dry-run.ts feeds it the real files of a
 * checkout; nothing here uploads, deploys, signs or opens a connection.
 *
 * It follows the layout that already exists, rather than inventing another one:
 * - hosting: firebase.json, served from Firebase Hosting site `<project>-kestrel` (infra/gcp/main.tf), public origin in
 *   config/public-site.json;
 * - downloads bucket `<project>-kestrel-downloads`: releases/<version>/<installer>, releases/<version>/SHA256SUMS.txt
 *   and latest.json, exactly as scripts/release/publish-gcp.ps1 -Installers writes them;
 * - models bucket `<project>-kestrel-models`: data/onnx/<asset id>/<model version>/<file> and manifest/stable.json,
 *   exactly as scripts/release/sign-data-manifest.ts lays them out (src/core/modelManifestPlan.ts).
 */
import { LEGACY_MAX_BYTES } from './dataUpdateManifest';
import { manifestFor, type PlannedAsset } from './modelManifestPlan';
import { OPTIONAL_MODELS, packAssetId, type OptionalModel } from './optionalModels';

/** The manifest key the app and the control plane pin (scripts/release/sign-data-manifest.ts, infra/gcp/variables.tf). */
export const MODEL_KEY_ID = 'kestrel-2026-11';
/** Cloud Run services the website may forward to. Anything else in firebase.json is a mistake. */
export const HOSTING_SERVICES = ['inflight-v2proto', 'kestrel-control-plane'] as const;
export const HOSTING_REGION = 'europe-west2';

export interface InstallerFile { name: string; bytes: number; sha256: string }

export interface VisionModelEntry {
  repo: string;
  revision: string;
  license: string;
  files: { path: string; bytes: number; sha256?: string; gitBlob?: string }[];
}

export interface PublishInput {
  /** Google Cloud project id; the bucket and Hosting names derive from it as in infra/gcp/main.tf. */
  project: string;
  /** config/public-site.json */
  publicSite: { origin: string; firebaseOrigin: string };
  /** firebase.json, parsed. */
  firebase: unknown;
  /** App version for installers (the v-tag without the v), e.g. 26.11.4. Optional: no installers without it. */
  version?: string;
  installers?: readonly InstallerFile[];
  /** Version folder for model pack files in the models bucket, e.g. 2026.11.26. */
  modelVersion: string;
  packs?: readonly OptionalModel[];
  /** scripts/models/manifest.json `models`: the local vision models fetched from their authors' host. */
  visionModels?: Record<string, VisionModelEntry>;
  /** The VITE_ settings a release build of this checkout would use (.env.local plus the environment). */
  buildEnv: Record<string, string | undefined>;
  /** The commit being published. Null when there is no git checkout to ask. */
  commit: { sha: string; onMain: boolean; dirty: boolean } | null;
}

export interface Check { ok: boolean; what: string }
export interface PlannedObject { bucket: string; path: string; url: string; bytes?: number; sha256?: string; cacheControl: string }
export interface PackRow {
  pack: string;
  name: string;
  role: string;
  assetId: string;
  file: string;
  bytes: number;
  sha256: string;
  url: string;
  tier: OptionalModel['tier'];
  licence: string;
  /** Publishable as pinned now; otherwise why not. */
  status: 'ready' | 'needs-allow-large' | 'held';
  reason?: string;
}

export interface PublishPlan {
  buckets: { downloads: string; models: string; hostingSite: string };
  hosting: Check[];
  downloads: { objects: PlannedObject[]; sha256sums: string; latestPreview: unknown | null };
  modelPacks: PackRow[];
  visionModels: { id: string; repo: string; revision: string; license: string; pinnedFiles: number; int8Bytes: number; q4Bytes: number }[];
  buildSettings: Check[];
  problems: string[];
  notes: string[];
  commands: string[];
  approvals: string[];
}

const GCS = 'https://storage.googleapis.com';
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const HEX64 = /^[0-9a-f]{64}$/;
/** A file name that is the same in a URL, a shell and SHA256SUMS.txt: no spaces, no escapes needed. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const APP_VERSION = /^\d{2}\.\d{1,2}\.\d{1,3}$/;

/** Which website download card a file belongs to, the same rule publish-gcp.ps1 uses when it merges latest.json. */
export function installerPlatform(name: string): 'mac' | 'windows' | 'android' | null {
  if (/\.(dmg|pkg)$/i.test(name)) return 'mac';
  if (/\.(msi|msix|exe)$/i.test(name)) return 'windows';
  if (/\.apk$/i.test(name)) return 'android';
  return null;
}

function headerValue(firebase: Record<string, unknown>, source: string, key: string): string | null {
  for (const rule of arr(firebase.headers)) {
    if (!obj(rule) || rule.source !== source) continue;
    for (const h of arr(rule.headers)) if (obj(h) && h.key === key && typeof h.value === 'string') return h.value;
  }
  return null;
}

export function checkHosting(input: Pick<PublishInput, 'project' | 'publicSite' | 'firebase'>): Check[] {
  const checks: Check[] = [];
  const add = (ok: boolean, what: string) => checks.push({ ok, what });
  const site = `${input.project}-kestrel`;
  const hosting = obj(input.firebase) && obj(input.firebase.hosting) ? input.firebase.hosting : null;
  if (!hosting) { add(false, 'firebase.json has no "hosting" section.'); return checks; }
  add(hosting.site === site, `Hosting site is ${String(hosting.site)} (expected ${site}, from infra/gcp/main.tf).`);
  add(hosting.public === 'site', `Hosting serves the "${String(hosting.public)}" folder (expected "site").`);
  add(input.publicSite.firebaseOrigin === `https://${site}.web.app`, `config/public-site.json firebaseOrigin is ${input.publicSite.firebaseOrigin} (expected https://${site}.web.app).`);
  let origin: URL | null = null;
  try { origin = new URL(input.publicSite.origin); } catch { /* reported below */ }
  add(Boolean(origin && origin.protocol === 'https:' && origin.pathname === '/' && !origin.search && !origin.username),
    `Public address ${input.publicSite.origin} is a plain https origin.`);
  const rewrites = arr(hosting.rewrites);
  const stray = rewrites.filter((r) => !obj(r) || !obj(r.run) || !(HOSTING_SERVICES as readonly string[]).includes(String(r.run.serviceId)) || r.run.region !== HOSTING_REGION);
  add(stray.length === 0, stray.length ? `${stray.length} rewrite(s) go somewhere other than ${HOSTING_SERVICES.join(' or ')} in ${HOSTING_REGION}.` : `All ${rewrites.length} rewrites go to ${HOSTING_SERVICES.join(' or ')} in ${HOSTING_REGION}.`);
  const catchAll = rewrites.some((r) => obj(r) && (r.source === '**' || r.source === '/**'));
  add(!catchAll, catchAll ? 'A catch-all rewrite would hide the static site.' : 'No catch-all rewrite: the static pages are served as files.');
  for (const source of ['/V2Proto', '/V2Proto/**']) {
    const robots = headerValue(hosting, source, 'X-Robots-Tag') ?? '';
    const cache = headerValue(hosting, source, 'Cache-Control') ?? '';
    add(/noindex/.test(robots) && /no-store/.test(cache), `${source} (staging preview) is noindex and no-store.`);
  }
  add(/noindex/.test(headerValue(hosting, '/admin', 'X-Robots-Tag') ?? ''), '/admin is noindex.');
  add(/nosniff/.test(headerValue(hosting, '**', 'X-Content-Type-Options') ?? ''), 'Every page sends X-Content-Type-Options: nosniff.');
  return checks;
}

export function planDownloads(project: string, version: string | undefined, installers: readonly InstallerFile[]): { objects: PlannedObject[]; sha256sums: string; latestPreview: unknown | null; problems: string[]; notes: string[] } {
  const bucket = `${project}-kestrel-downloads`;
  const problems: string[] = [];
  const notes: string[] = [];
  if (!installers.length) return { objects: [], sha256sums: '', latestPreview: null, problems, notes: ['No installers given: the downloads bucket would not change. Pass --installers <folder> to plan a release.'] };
  if (!version || !APP_VERSION.test(version)) { problems.push(`App version "${version ?? ''}" is not like 26.11.4 (the v-tag without the v).`); return { objects: [], sha256sums: '', latestPreview: null, problems, notes }; }
  const objects: PlannedObject[] = [];
  const perPlatform = new Map<string, string[]>();
  for (const file of [...installers].sort((a, b) => a.name.localeCompare(b.name))) {
    if (/\.aab$/i.test(file.name)) { problems.push(`${file.name}: an Android App Bundle is for the Play Console only, never a direct download.`); continue; }
    if (/\.ipa$/i.test(file.name)) { problems.push(`${file.name}: iPhone and iPad apps go through the App Store or TestFlight only.`); continue; }
    const platform = installerPlatform(file.name);
    if (!platform) { problems.push(`${file.name}: not an installer the website shows (.dmg, .pkg, .msi, .msix, .exe or .apk).`); continue; }
    if (!SAFE_NAME.test(file.name)) { problems.push(`${file.name}: rename it without spaces or symbols, so the address, SHA256SUMS.txt and the website agree.`); continue; }
    if (!HEX64.test(file.sha256) || !(file.bytes > 0)) { problems.push(`${file.name}: empty file or unreadable digest.`); continue; }
    perPlatform.set(platform, [...(perPlatform.get(platform) ?? []), file.name]);
    const path = `releases/${version}/${file.name}`;
    objects.push({ bucket, path, url: `${GCS}/${bucket}/${path}`, bytes: file.bytes, sha256: file.sha256, cacheControl: 'bucket default (public, max-age=3600)' });
  }
  for (const [platform, names] of perPlatform) if (names.length > 1) notes.push(`${platform}: ${names.length} files (${names.join(', ')}). The website shows the first; check that is the one you mean.`);
  const kept = objects.filter((o) => o.sha256);
  const sha256sums = kept.map((o) => `${o.sha256}  ${o.path.split('/').pop()}`).join('\n') + (kept.length ? '\n' : '');
  if (kept.length) {
    objects.push({ bucket, path: `releases/${version}/SHA256SUMS.txt`, url: `${GCS}/${bucket}/releases/${version}/SHA256SUMS.txt`, cacheControl: 'bucket default (public, max-age=3600)' });
    objects.push({ bucket, path: 'latest.json', url: `${GCS}/${bucket}/latest.json`, cacheControl: 'public, max-age=300' });
    notes.push('latest.json is merged, not replaced: entries for platforms not in this release, and the store links, are kept (publish-gcp.ps1 Get-Latest).');
  }
  const latestPreview = kept.length ? {
    version,
    published: '(set at publish time)',
    files: kept.map((o) => ({ name: o.path.split('/').pop(), version, bytes: o.bytes, sha256: o.sha256, url: o.url })),
  } : null;
  return { objects, sha256sums, latestPreview, problems, notes };
}

export function planModelPacks(project: string, modelVersion: string, packs: readonly OptionalModel[] = OPTIONAL_MODELS): { rows: PackRow[]; problems: string[] } {
  const base = `${GCS}/${project}-kestrel-models`;
  const rows: PackRow[] = [];
  const problems: string[] = [];
  for (const pack of packs) {
    const roles = Object.entries(pack.files);
    const unpinned = roles.filter(([, f]) => !HEX64.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes <= 0).map(([role]) => role);
    for (const [role, file] of roles) {
      const assetId = packAssetId(pack, role);
      const name = file.file ?? `${assetId}.onnx`;
      const path = `/data/onnx/${assetId}/${modelVersion}/${name}`;
      let status: PackRow['status'] = 'ready';
      let reason: string | undefined;
      if (unpinned.length) { status = 'held'; reason = `size or digest not pinned for ${unpinned.join(', ')} in src/core/optionalModels.ts, so the app keeps the pack out of sight`; }
      else if (file.bytes > LEGACY_MAX_BYTES) { status = 'needs-allow-large'; reason = `${Math.round(file.bytes / 1048576)} MiB is over the ${LEGACY_MAX_BYTES / 1048576} MiB older installed apps accept; signing it needs --allow-large, and those apps then refuse the whole manifest`; }
      rows.push({ pack: pack.id, name: pack.name, role, assetId, file: name, bytes: file.bytes, sha256: file.sha256, url: base + path, tier: pack.tier, licence: pack.licence, status, ...(reason ? { reason } : {}) });
    }
  }
  // The same rule the app uses: build the manifest these rows would make and let the real parser accept or refuse it.
  const listable = rows.filter((r) => r.status !== 'held');
  const assets: PlannedAsset[] = listable.map((r) => ({ id: r.assetId, kind: 'onnx', version: modelVersion, path: r.url.slice(base.length), bytes: r.bytes, sha256: r.sha256, file: r.file, licence: { spdx: r.licence, source: '' } }));
  if (assets.length && !manifestFor(assets, 1)) problems.push(`The app would refuse a manifest with these packs at model version "${modelVersion}" (check the version is like 2026.11.26).`);
  return { rows, problems };
}

export function checkBuildSettings(project: string, siteOrigin: string, env: Record<string, string | undefined>): Check[] {
  const models = `${GCS}/${project}-kestrel-models`;
  const val = (k: string) => (env[k] ?? '').trim();
  return [
    { ok: val('VITE_KESTREL_MODEL_BASE_URL').replace(/\/+$/, '') === models, what: `VITE_KESTREL_MODEL_BASE_URL is ${val('VITE_KESTREL_MODEL_BASE_URL') || 'unset'} (expected ${models}). Without it a release build offers no model packs and no model updates.` },
    { ok: val('VITE_KESTREL_MODEL_KEYS').split(',').some((k) => k.trim().startsWith(`${MODEL_KEY_ID}=`)), what: `VITE_KESTREL_MODEL_KEYS ${val('VITE_KESTREL_MODEL_KEYS') ? 'is set' : 'is unset'} (needs the public half of ${MODEL_KEY_ID}, see .env.example).` },
    { ok: val('VITE_KESTREL_SITE_URL').replace(/\/+$/, '') === siteOrigin.replace(/\/+$/, ''), what: `VITE_KESTREL_SITE_URL is ${val('VITE_KESTREL_SITE_URL') || 'unset'} (expected ${siteOrigin}, for desktop gallery links and Apple sign-in).` },
  ];
}

export function planPublish(input: PublishInput): PublishPlan {
  const buckets = { downloads: `${input.project}-kestrel-downloads`, models: `${input.project}-kestrel-models`, hostingSite: `${input.project}-kestrel` };
  const problems: string[] = [];
  const notes: string[] = [];
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(input.project)) problems.push(`"${input.project}" is not a Google Cloud project id.`);

  if (!input.commit) problems.push('No git checkout: cannot tell which commit would be published.');
  else {
    if (input.commit.dirty) problems.push(`The checkout has uncommitted changes; publish only a clean commit (sign-data-manifest.ts refuses too).`);
    if (!input.commit.onMain) problems.push(`Commit ${input.commit.sha.slice(0, 12)} is not on origin/main. Only a main commit checked on /V2Proto is promoted (docs/RELEASE-FLOW.md).`);
  }

  const hosting = checkHosting(input);
  for (const c of hosting) if (!c.ok) problems.push(`Hosting: ${c.what}`);

  const downloads = planDownloads(input.project, input.version, input.installers ?? []);
  problems.push(...downloads.problems.map((p) => `Downloads: ${p}`));
  notes.push(...downloads.notes);

  const packs = planModelPacks(input.project, input.modelVersion, input.packs);
  problems.push(...packs.problems.map((p) => `Model packs: ${p}`));
  for (const r of packs.rows) if (r.status !== 'ready') notes.push(`${r.name} (${r.file}): ${r.reason}.`);

  const visionModels = Object.entries(input.visionModels ?? {}).map(([id, m]) => {
    const onnx = (q: string) => m.files.filter((f) => f.path.endsWith(`_${q}.onnx`)).reduce((s, f) => s + f.bytes, 0);
    return { id, repo: m.repo, revision: m.revision, license: m.license, pinnedFiles: m.files.filter((f) => f.sha256 || f.gitBlob).length, int8Bytes: onnx('int8'), q4Bytes: onnx('q4') };
  });
  if (visionModels.length) notes.push(`Local vision models (${visionModels.map((v) => v.id).join(', ')}) are not in the models bucket: scripts/models/acquire.py fetches them from their authors' host at the pinned revision and checks every file. Mirroring them needs a decision (size limits and a second packaging contract).`);

  const buildSettings = checkBuildSettings(input.project, input.publicSite.origin, input.buildEnv);
  for (const c of buildSettings) if (!c.ok) problems.push(`Release build: ${c.what}`);

  const ready = packs.rows.filter((r) => r.status === 'ready');
  const large = packs.rows.filter((r) => r.status === 'needs-allow-large');
  const packBytes = [...ready, ...large].reduce((s, r) => s + r.bytes, 0);
  notes.push(`Model packs listed: ${ready.length + large.length} file(s), ${(packBytes / 1e9).toFixed(2)} GB. Each full download of every pack is that much bucket egress; 100 photographers taking all of them is about ${(packBytes * 100 / 1e9).toFixed(0)} GB.`);

  const installerArgs = (input.installers ?? []).map((f) => f.name).join(',');
  const commands = [
    `# 1. Website (Firebase Hosting site ${buckets.hostingSite}, served at ${input.publicSite.origin})`,
    `pwsh scripts/release/publish-gcp.ps1 -Project ${input.project} -Website -SiteUrl ${input.publicSite.origin}`,
    `# 2. Installers into gs://${buckets.downloads}/releases/${input.version ?? '<version>'}/ and latest.json`,
    `pwsh scripts/release/publish-gcp.ps1 -Project ${input.project} -Version ${input.version ?? '<version>'} -Installers ${installerArgs || '<installer files>'}`,
    `# 3. Model packs: sign the one manifest (needs the signing key from Secret Manager), then upload files first, manifest last`,
    `npx tsx scripts/release/sign-data-manifest.ts --dir <folder with the pack files> --version ${input.modelVersion} --revision <last published + 1> --out out/models${large.length ? ' --allow-large' : ''}`,
    `pwsh scripts/release/publish-gcp.ps1 -Project ${input.project} -Models out/models`,
    `# 4. Read-only check afterwards`,
    `bash infra/gcp/check-go-live.sh`,
  ];
  const approvals = [
    `Say go for the commit to promote${input.commit ? ` (${input.commit.sha.slice(0, 12)})` : ''}, after checking it on /V2Proto.`,
    ...(buildSettings.slice(0, 2).every((c) => c.ok) ? [] : ['Set VITE_KESTREL_MODEL_BASE_URL and VITE_KESTREL_MODEL_KEYS (public values, .env.example) in the release build settings on both machines, so installers offer model packs.']),
    `Approve reading the manifest signing key (${MODEL_KEY_ID}, Secret Manager) to sign the model manifest.`,
    `Approve uploading the model packs (${(packBytes / 1e9).toFixed(2)} GB) to the public models bucket, knowing downloads are billed as egress.`,
    ...(large.length ? [`Decide on ${large.map((r) => r.name).join(', ')}: over ${LEGACY_MAX_BYTES / 1048576} MiB, so listing it needs --allow-large, which older installed apps refuse. Ship it in a second manifest revision after an app update, or leave it out at launch.`] : []),
    'Approve the installer upload and latest.json update (the website download cards change within five minutes).',
    'Approve the Firebase Hosting deploy of the website.',
    'Publish the draft GitHub release yourself to start desktop updates; nothing publishes it automatically.',
  ];
  return { buckets, hosting, downloads: { objects: downloads.objects, sha256sums: downloads.sha256sums, latestPreview: downloads.latestPreview }, modelPacks: packs.rows, visionModels, buildSettings, problems, notes, commands, approvals };
}
